import type { TripState, TripPhase, RiskLevel } from "@/schemas/trip-state";
import type { Trip, ItineraryItem } from "@/types/travel";
import type { Reservation } from "@/schemas/reservation";
import type { TravelEvent } from "@/schemas/travel-event";
import type { TripHardConstraint } from "@/services/brain/constraints";
import { buildTripConstraints, evaluateTripConstraints } from "@/services/brain/constraints";
import { buildTodayContext } from "@/services/today/context";

/**
 * TripState Engine (Phase 6.4).
 *
 * One pure function that answers "where is this traveller, what's ahead, and
 * how risky is it". Deterministic, LLM-free, provider-free: everything is
 * derived from the Trip (items, segments, weather, reservations, events) plus
 * an instant. The Today console, the Impact Engine and the agent tools all
 * read from here — there is no second state computation anywhere.
 *
 * Wall-clock semantics are Asia/Shanghai (the trip's date basis), computed by
 * shifting the instant and reading UTC fields — no DST in that offset.
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
/** A snapshot older than this is flagged stale (offline/cached data). */
const STALE_THRESHOLD_MS = 6 * 60 * 60_000;

function shanghaiParts(epochMs: number) {
  const shifted = new Date(epochMs + SHANGHAI_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Events whose window covers the instant (point events stay until acknowledged). */
export function collectActiveEvents(events: TravelEvent[], asOfMs: number, includeAcknowledged = true): TravelEvent[] {
  return events.filter((event) => {
    if (!includeAcknowledged && event.acknowledgedAt) return false;
    const fromMs = Date.parse(event.effectiveFrom ?? event.occurredAt);
    if (Number.isFinite(fromMs) && fromMs > asOfMs) return false;
    const untilMs = event.effectiveUntil ? Date.parse(event.effectiveUntil) : undefined;
    if (untilMs !== undefined && Number.isFinite(untilMs) && untilMs < asOfMs) return false;
    return true;
  });
}

function reservationSnapshot(reservation: Reservation) {
  return {
    reservationId: reservation.id,
    type: reservation.type,
    title: reservation.title,
    status: reservation.status,
    startAt: reservation.startAt,
    ...(reservation.endAt ? { endAt: reservation.endAt } : {}),
    ...(reservation.location ? { location: reservation.location } : {}),
    ...(reservation.confirmationCode ? { confirmationCode: reservation.confirmationCode } : {}),
  };
}

function itemSnapshot(trip: Trip, item: ItineraryItem) {
  const day = trip.days.find((candidate) => candidate.id === item.dayId);
  return {
    itemId: item.id,
    dayId: item.dayId,
    date: day?.date ?? "",
    placeId: item.placeId,
    placeName: trip.places.find((place) => place.id === item.placeId)?.name ?? item.placeId,
    type: item.type,
    startTime: item.startTime,
    duration: item.duration,
    status: item.status,
  };
}

export function getTripState(trip: Trip, options: { asOf?: string } = {}): TripState {
  const asOfMs = Date.parse(options.asOf ?? new Date().toISOString());
  if (!Number.isFinite(asOfMs)) throw new Error("Invalid asOf instant");
  const now = shanghaiParts(asOfMs);
  const computedAt = new Date().toISOString();

  // Phase: where the instant sits relative to the trip dates.
  let phase: TripPhase = "during";
  if (trip.startDate && now.date < trip.startDate) phase = "before";
  else if (trip.endDate && now.date > trip.endDate) phase = "after";

  const currentDay = phase === "during"
    ? trip.days.find((day) => day.date === now.date) ?? null
    : null;
  const focusedDay = currentDay ?? trip.days.find((day) => day.date >= now.date) ?? trip.days[0] ?? null;

  // Day-level progress comes from the existing Today context — the same
  // computation the Today screen shows, never a second implementation.
  const today = focusedDay
    ? buildTodayContext(trip, { dayId: focusedDay.id, asOf: `${now.date}T${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}` })
    : null;

  const allItems = [...trip.items].sort((a, b) => {
    const dayA = trip.days.find((day) => day.id === a.dayId)?.index ?? 0;
    const dayB = trip.days.find((day) => day.id === b.dayId)?.index ?? 0;
    return dayA - dayB || a.order - b.order;
  });
  const completedCount = allItems.filter((item) => item.status === "done").length;
  const remainingItems = allItems
    .filter((item) => item.status !== "done" && item.status !== "skipped")
    .map((item) => itemSnapshot(trip, item));

  const todayCurrent = today?.current ?? null;
  const todayNext = today?.next ?? null;
  const currentItemEntity = todayCurrent ? trip.items.find((item) => item.id === todayCurrent.itemId) : undefined;
  const nextItemEntity = todayNext ? trip.items.find((item) => item.id === todayNext.itemId) : undefined;

  // Remaining walk/travel: focused day (from Today context) + all later days.
  const focusedDayIndex = focusedDay ? focusedDay.index : 0;
  const laterDayIds = new Set(trip.days.filter((day) => day.index > focusedDayIndex).map((day) => day.id));
  const laterSegments = trip.segments.filter((segment) => laterDayIds.has(segment.dayId));
  const remainingTravelMinutes = laterSegments.reduce((sum, segment) => sum + (segment.minutes ?? 0), 0);

  // Reservations: active or upcoming after the instant.
  const activeReservations = (trip.reservations ?? [])
    .filter((reservation) => {
      if (reservation.status === "cancelled") return false;
      const startMs = Date.parse(reservation.startAt);
      if (!Number.isFinite(startMs)) return false;
      const endMs = reservation.endAt ? Date.parse(reservation.endAt) : startMs + 60 * 60_000;
      return endMs >= asOfMs;
    })
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map(reservationSnapshot);

  // Hard constraints still ahead of the traveller.
  const upcomingHardConstraints = buildTripConstraints(trip)
    .filter((constraint) => constraint.endMs === undefined ? constraint.startMs + 60 * 60_000 >= asOfMs : constraint.endMs >= asOfMs)
    .slice(0, 5)
    .map((constraint: TripHardConstraint) => ({
      id: constraint.id,
      kind: constraint.kind,
      title: constraint.title,
      startAt: new Date(constraint.startMs).toISOString(),
      ...(constraint.endMs ? { endAt: new Date(constraint.endMs).toISOString() } : {}),
    }));

  const activeEvents = collectActiveEvents(trip.travelEvents ?? [], asOfMs, true);
  const evaluation = evaluateTripConstraints(trip);

  // Lateness: only meaningful while the trip is running with a current stop.
  // Before departure / after return there is no plan to be late for.
  let lateByMinutes: number | null = null;
  let aheadByMinutes: number | null = null;
  if (phase === "during" && today?.lateMinutes !== null && today?.lateMinutes !== undefined) {
    if (today.lateMinutes >= 0) lateByMinutes = today.lateMinutes;
    else aheadByMinutes = -today.lateMinutes;
  }

  const estimatedSpend = trip.estimatedSpend;
  const budgetState = {
    budget: trip.budget,
    estimatedSpend,
    remaining: trip.budget - estimatedSpend,
  };

  const updatedMs = Date.parse(trip.updatedAt ?? trip.createdAt ?? computedAt);
  const stale = Number.isFinite(updatedMs) && asOfMs - updatedMs > STALE_THRESHOLD_MS;

  // Risk: deterministic roll-up of events, lateness, constraints and budget.
  let riskLevel: RiskLevel = "low";
  const criticalEvents = activeEvents.filter((event) => event.severity === "critical");
  const warningEvents = activeEvents.filter((event) => event.severity === "warning");
  const hardErrors = evaluation.hardViolations.filter((violation) => violation.severity === "error");
  if (criticalEvents.length > 0 || hardErrors.length > 0 || (lateByMinutes ?? 0) > 60 || budgetState.remaining < 0) {
    riskLevel = "high";
  } else if (warningEvents.length > 0 || (lateByMinutes ?? 0) > 15 || evaluation.softPenalties.length > 0 || upcomingHardConstraints.length > 0) {
    riskLevel = "medium";
  }

  // Suggested actions: every entry traceable to a concrete trigger.
  const suggestedActions: string[] = [];
  if ((lateByMinutes ?? 0) > 15) suggestedActions.push(`已晚 ${lateByMinutes} 分钟：考虑跳过或缩短一个低优先级站点`);
  if (warningEvents.some((event) => event.type === "HEAVY_RAIN")) suggestedActions.push("降雨进行中：把户外安排换成室内方案");
  if (warningEvents.some((event) => event.type === "EXTREME_HEAT")) suggestedActions.push("高温预警：避开正午户外行程，补水防晒");
  if (evaluation.softPenalties.some((penalty) => penalty.constraintId.startsWith("walking"))) suggestedActions.push("步行超出偏好：可改乘地铁或打车减少步行");
  if (budgetState.remaining < 0) suggestedActions.push(`预估花费已超预算 ¥${-budgetState.remaining}：控制今日支出`);
  const nextConstraint = upcomingHardConstraints[0];
  if (nextConstraint) suggestedActions.push(`预留时间前往「${nextConstraint.title}」(${new Date(nextConstraint.startAt).toISOString()} 前到达)`);
  if (phase === "before") suggestedActions.push("行程尚未开始：可先完成出发前任务");

  return {
    tripId: trip.id,
    asOf: new Date(asOfMs).toISOString(),
    computedAt,
    stale,
    phase,
    currentDay: currentDay ? { dayId: currentDay.id, date: currentDay.date, index: currentDay.index } : null,
    currentItem: currentItemEntity ? itemSnapshot(trip, currentItemEntity) : null,
    nextItem: nextItemEntity ? itemSnapshot(trip, nextItemEntity) : null,
    completedCount,
    remainingItems,
    activeReservations,
    upcomingHardConstraints,
    currentWeather: today?.weather ? {
      date: today.date,
      condition: today.weather.condition,
      tempC: today.weather.tempC,
      icon: today.weather.icon,
    } : null,
    activeEvents: activeEvents.map((event) => ({
      id: event.id,
      type: event.type,
      severity: event.severity,
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.effectiveFrom ? { effectiveFrom: event.effectiveFrom } : {}),
      ...(event.effectiveUntil ? { effectiveUntil: event.effectiveUntil } : {}),
    })),
    lateByMinutes,
    aheadByMinutes,
    remainingWalkingMeters: today?.remaining.walkMeters ?? 0,
    remainingTravelMinutes,
    estimatedFinishTime: today?.remaining.estimatedEndTime ?? null,
    budgetState,
    riskLevel,
    constraintViolations: evaluation.hardViolations.map((violation) => violation.detail),
    suggestedActions,
  };
}
