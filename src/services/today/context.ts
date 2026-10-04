import { haversineMeters, estimateTransit } from "@/lib/utils";
import type { Trip } from "@/types/travel";

/**
 * Today Mode v2 execution context — pure, deterministic, no I/O. Shared by
 * the runtime command (`get-today-context`, served to MCP/Agent/API) and the
 * Today page console, so the console and the agent always agree on the same
 * numbers. Suggestions are rule-based and always map to a user-initiated
 * propose-change; nothing here writes a trip.
 */
export interface TodayTransit {
  mode: string;
  minutes: number;
  distanceMeters: number;
  estimated: boolean;
  provider: string;
}

export interface TodayContext {
  dayId: string;
  date: string;
  asOf: string | null;
  weather: Trip["days"][number]["weather"] | null;
  current: { itemId: string; placeId: string; name: string; startTime: string; endTime: string | null; duration: number; status: string } | null;
  next: {
    itemId: string;
    placeId: string;
    name: string;
    stayMinutes: number;
    transit: TodayTransit | null;
    suggestedDeparture: string | null;
    estimatedArrival: string | null;
  } | null;
  remaining: { places: number; walkMeters: number; estimatedEndTime: string | null };
  lateMinutes: number | null;
  suggestions: Array<{ kind: string; message: string }>;
}

/** "HH:mm" (or the clock part of an ISO string) → minutes since midnight. */
export function clockMinutesOf(value: string): number | null {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** minutes since midnight → "HH:mm" (wraps past midnight). */
export function addClockMinutes(start: string | null, minutes: number): string | null {
  const base = start ? clockMinutesOf(start) : null;
  if (base === null) return null;
  const total = (((base + Math.max(0, Math.round(minutes))) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function buildTodayContext(trip: Trip, options: { dayId?: string; asOf?: string } = {}): TodayContext {
  const asOfDate = options.asOf?.slice(0, 10);
  const asOfClock = options.asOf ? clockMinutesOf(options.asOf) : null;
  const day = (options.dayId ? trip.days.find((candidate) => candidate.id === options.dayId) : undefined)
    ?? trip.days.find((candidate) => asOfDate && candidate.date === asOfDate)
    ?? trip.days[0];
  if (!day) throw new Error("Trip has no days");

  const items = trip.items
    .filter((item) => item.dayId === day.id)
    .sort((left, right) => left.order - right.order);
  const nameOf = (placeId: string) => trip.places.find((place) => place.id === placeId)?.name ?? "";
  const remaining = items.filter((item) => item.status !== "done" && item.status !== "skipped");
  const current = remaining[0] ?? null;
  const next = remaining[1] ?? null;

  const remainingIds = new Set(remaining.map((item) => item.id));
  const remainingWalkMeters = trip.segments
    .filter((segment) => segment.dayId === day.id && segment.mode === "walk" && segment.fromItemId && remainingIds.has(segment.fromItemId))
    .reduce((sum, segment) => sum + (segment.distanceMeters ?? segment.meters ?? 0), 0);
  const lastRemaining = remaining[remaining.length - 1] ?? null;
  const estimatedEndTime = lastRemaining?.endTime ?? addClockMinutes(lastRemaining?.startTime ?? null, lastRemaining?.duration ?? 0);

  let transit: TodayTransit | null = null;
  if (current && next) {
    const segment = trip.segments.find((candidate) => candidate.fromItemId === current.id && candidate.toItemId === next.id);
    if (segment) {
      transit = {
        mode: segment.mode,
        minutes: segment.minutes ?? segment.durationMinutes,
        distanceMeters: segment.distanceMeters ?? segment.meters ?? 0,
        estimated: segment.estimated,
        provider: segment.provider,
      };
    } else {
      const currentPlace = trip.places.find((place) => place.id === current.placeId);
      const nextPlace = trip.places.find((place) => place.id === next.placeId);
      if (currentPlace && nextPlace) {
        const meters = haversineMeters(currentPlace, nextPlace);
        const estimate = estimateTransit(meters);
        transit = { mode: estimate.mode, minutes: estimate.minutes, distanceMeters: Math.round(meters), estimated: true, provider: "haversine" };
      }
    }
  }

  const suggestedDeparture = current ? (current.endTime ?? addClockMinutes(current.startTime, current.duration)) : null;
  const estimatedArrival = suggestedDeparture && transit ? addClockMinutes(suggestedDeparture, transit.minutes) : next?.startTime ?? null;

  let lateMinutes: number | null = null;
  if (asOfClock !== null && current) {
    const plannedClock = clockMinutesOf(current.startTime);
    if (plannedClock !== null) lateMinutes = asOfClock - plannedClock;
  }

  const suggestions: Array<{ kind: string; message: string }> = [];
  if ((day.weather?.icon === "rain" || (day.weather?.condition ?? "").includes("雨")) && remaining.length > 1) {
    suggestions.push({ kind: "rain", message: "今天有雨，可以考虑把户外地点换成室内方案或调整顺序" });
  }
  if (remainingWalkMeters > 5000) {
    suggestions.push({ kind: "high_walking", message: `今天剩余步行约 ${(remainingWalkMeters / 1000).toFixed(1)} km，可以切换到少走路的方案` });
  }
  if (lateMinutes !== null && lateMinutes > 30) {
    suggestions.push({ kind: "late", message: `现在比计划晚了约 ${lateMinutes} 分钟，可以考虑取消一个低优先级地点` });
  }
  if (transit && transit.distanceMeters > 8000) {
    suggestions.push({ kind: "far_next", message: `下一站较远（约 ${(transit.distanceMeters / 1000).toFixed(1)} km），建议地铁或打车前往` });
  }

  return {
    dayId: day.id,
    date: day.date,
    asOf: options.asOf ?? null,
    weather: day.weather ?? null,
    current: current ? {
      itemId: current.id, placeId: current.placeId, name: nameOf(current.placeId),
      startTime: current.startTime, endTime: current.endTime ?? null, duration: current.duration, status: current.status,
    } : null,
    next: next ? {
      itemId: next.id, placeId: next.placeId, name: nameOf(next.placeId),
      stayMinutes: next.duration, transit, suggestedDeparture, estimatedArrival,
    } : null,
    remaining: { places: remaining.length, walkMeters: Math.round(remainingWalkMeters), estimatedEndTime },
    lateMinutes,
    suggestions,
  };
}
