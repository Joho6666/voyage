import type { TravelEvent, TravelEventType } from "@/schemas/travel-event";
import type { TripState } from "@/schemas/trip-state";
import type { Trip } from "@/types/travel";
import { getTripState } from "@/services/trip-state/engine";
import { clockMinutesOf } from "@/services/today/context";

/**
 * Impact Engine (Phase 6.5).
 *
 * Answers "what changed and what does it affect" for one TravelEvent — a
 * deterministic rule matrix, no LLM. The LLM may later EXPLAIN the result but
 * never decides the dependency graph itself. Every output entity is traceable
 * to a concrete Trip record; unknown payload data produces explicit gaps in
 * the summary instead of assumptions.
 */

export interface ImpactEntity {
  kind: "reservation" | "item" | "day" | "segment" | "place";
  id: string;
  label: string;
  relation: string;
}

export interface ImpactOption {
  label: string;
  detail: string;
  /** The action family a replan proposal would use (see propose-event-replan). */
  strategy: "shift" | "skip" | "indoorSwap" | "replace" | "release" | "reduceWalking" | "reduceBudget" | "swapMode" | "monitor";
}

export interface ImpactResult {
  eventType: TravelEventType;
  severity: "info" | "warning" | "critical";
  affectedEntities: ImpactEntity[];
  atRiskItemIds: string[];
  impossibleItemIds: string[];
  recoverableItemIds: string[];
  constraintViolations: string[];
  timeDeltaMinutes: number;
  budgetDelta: number;
  walkingDeltaMeters: number;
  recommendedStrategy: ImpactOption["strategy"];
  summary: string;
  options: ImpactOption[];
  /** Data the event should have carried but didn't — never guessed. */
  unknowns: string[];
}

const TRIP_TZ_SUFFIX = "+08:00";

function itemStartMs(trip: Trip, itemId: string): number | null {
  const item = trip.items.find((candidate) => candidate.id === itemId);
  const day = trip.days.find((candidate) => candidate.id === item?.dayId);
  if (!item || !day) return null;
  return Date.parse(`${day.date}T${item.startTime}:00${TRIP_TZ_SUFFIX}`);
}

function isOutdoorPlace(trip: Trip, placeId: string): boolean {
  const place = trip.places.find((candidate) => candidate.id === placeId);
  if (!place) return false;
  const haystack = [place.name, place.description, ...place.tags].join(" ");
  return /户外|公园|山|江|桥|步道|古镇|广场|夜景|索道|缆车/.test(haystack) || place.category === "viewpoint";
}

function itemLabel(trip: Trip, itemId: string): string {
  const item = trip.items.find((candidate) => candidate.id === itemId);
  return trip.places.find((place) => place.id === item?.placeId)?.name ?? item?.placeId ?? itemId;
}

function itemsOfTripOnDate(trip: Trip, date: string): string[] {
  const dayIds = new Set(trip.days.filter((day) => day.date === date).map((day) => day.id));
  return trip.items
    .filter((item) => dayIds.has(item.dayId) && item.status === "planned")
    .sort((a, b) => a.order - b.order)
    .map((item) => item.id);
}

function numbersFromPayload(event: TravelEvent, keys: string[]): number | null {
  for (const key of keys) {
    const value = event.payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function idsFromEntities(event: TravelEvent, kinds: Array<"reservation" | "item" | "place" | "day" | "segment">): string[] {
  return event.relatedEntities.filter((entity) => kinds.includes(entity.kind as never)).map((entity) => entity.id);
}

function walkMetersOfItem(trip: Trip, itemId: string): number {
  return trip.segments
    .filter((segment) => segment.fromItemId === itemId && segment.mode === "walk")
    .reduce((sum, segment) => sum + (segment.distanceMeters ?? segment.meters ?? 0), 0);
}

/**
 * Analyze one event's impact on the trip. `state` may be injected (when the
 * caller already computed TripState for this instant); otherwise it is derived
 * from the event's occurrence time.
 */
export function analyzeEventImpact(event: TravelEvent, trip: Trip, state?: TripState): ImpactResult {
  const resolvedState = state ?? getTripState(trip, { asOf: event.occurredAt });
  const affectedEntities: ImpactEntity[] = [];
  const atRiskItemIds: string[] = [];
  const impossibleItemIds: string[] = [];
  const recoverableItemIds: string[] = [];
  const constraintViolations: string[] = [...resolvedState.constraintViolations];
  const unknowns: string[] = [];
  const options: ImpactOption[] = [];
  let timeDeltaMinutes = 0;
  let budgetDelta = 0;
  let walkingDeltaMeters = 0;
  let recommendedStrategy: ImpactOption["strategy"] = "monitor";
  let severity: ImpactResult["severity"] = event.severity;

  const pushItem = (itemId: string, relation: string) => {
    if (affectedEntities.some((entity) => entity.kind === "item" && entity.id === itemId)) return;
    affectedEntities.push({ kind: "item", id: itemId, label: itemLabel(trip, itemId), relation });
  };
  const pushOption = (option: ImpactOption) => {
    if (options.some((candidate) => candidate.strategy === option.strategy)) return;
    options.push(option);
  };

  switch (event.type) {
    case "FLIGHT_DELAYED":
    case "TRAIN_DELAYED": {
      const delayMinutes = numbersFromPayload(event, ["delayMinutes", "minutes", "delay"]);
      if (delayMinutes === null) {
        unknowns.push("事件未提供 delayMinutes，无法量化顺移");
      }
      timeDeltaMinutes = delayMinutes ?? 0;
      const reservationId = idsFromEntities(event, ["reservation"])[0];
      const reservation = (trip.reservations ?? []).find((candidate) => candidate.id === reservationId);
      const arrivalDate = reservation
        ? new Date(Date.parse(reservation.endAt ?? reservation.startAt) + 8 * 60 * 60_000).toISOString().slice(0, 10)
        : resolvedState.currentDay?.date;
      if (!arrivalDate) {
        unknowns.push("无法确定延误影响的日期（预订缺少到达时间且不在行程中）");
        break;
      }
      if (reservation) {
        affectedEntities.push({ kind: "reservation", id: reservation.id, label: reservation.title, relation: "延误的预订" });
      }
      const dayItems = itemsOfTripOnDate(trip, arrivalDate);
      const arrivalLocal = reservation ? clockMinutesOf(new Date(Date.parse(reservation.endAt ?? reservation.startAt) + 8 * 60 * 60_000).toISOString().slice(11, 16)) ?? 0 : 0;
      for (const itemId of dayItems) {
        const startMs = itemStartMs(trip, itemId);
        if (startMs === null) continue;
        const arrivalMs = Date.parse(`${arrivalDate}T00:00:00${TRIP_TZ_SUFFIX}`) + (arrivalLocal + timeDeltaMinutes) * 60_000;
        if (startMs < arrivalMs) {
          impossibleItemIds.push(itemId);
          pushItem(itemId, "到达时间之前无法完成");
        } else {
          atRiskItemIds.push(itemId);
          pushItem(itemId, "需要顺移或压缩");
        }
      }
      // A hotel check-in window on the arrival day is protected, never dropped.
      for (const candidate of trip.reservations ?? []) {
        if (candidate.type === "hotel" && candidate.status === "confirmed") {
          affectedEntities.push({ kind: "reservation", id: candidate.id, label: candidate.title, relation: "入住时间受影响，必须保留" });
        }
      }
      recommendedStrategy = "shift";
      severity = "critical";
      pushOption({ label: "整体顺移", detail: `受影响站点顺延约 ${timeDeltaMinutes} 分钟，压缩停留时长`, strategy: "shift" });
      pushOption({ label: "跳过一站", detail: "放弃最晚的低优先级站点，保证其余安排", strategy: "skip" });
      break;
    }
    case "FLIGHT_CANCELLED": {
      severity = "critical";
      const reservationId = idsFromEntities(event, ["reservation"])[0];
      if (reservationId) {
        const reservation = (trip.reservations ?? []).find((candidate) => candidate.id === reservationId);
        if (reservation) {
          affectedEntities.push({ kind: "reservation", id: reservation.id, label: reservation.title, relation: "已取消的预订" });
        }
      } else {
        unknowns.push("事件未关联被取消的预订");
      }
      recommendedStrategy = "replace";
      pushOption({ label: "改签/替换交通", detail: "需要用户提供新的航班信息（导入新预订）", strategy: "replace" });
      pushOption({ label: "压缩当日行程", detail: "按新到达时间重新评估当日安排", strategy: "shift" });
      break;
    }
    case "HEAVY_RAIN":
    case "WEATHER_CHANGED": {
      const windowStart = event.effectiveFrom ?? event.occurredAt;
      const windowEnd = event.effectiveUntil;
      const startDate = new Date(Date.parse(windowStart) + 8 * 60 * 60_000).toISOString().slice(0, 10);
      for (const itemId of itemsOfTripOnDate(trip, startDate)) {
        const item = trip.items.find((candidate) => candidate.id === itemId);
        if (!item) continue;
        const startMs = itemStartMs(trip, itemId);
        if (startMs === null) continue;
        const inWindow = !windowEnd || startMs <= Date.parse(windowEnd);
        if (inWindow && isOutdoorPlace(trip, item.placeId)) {
          atRiskItemIds.push(itemId);
          pushItem(itemId, "雨天户外安排");
          walkingDeltaMeters += walkMetersOfItem(trip, itemId);
        }
      }
      if (!atRiskItemIds.length) unknowns.push("受影响时段内未找到户外安排（或地点元数据不足以判断室内外）");
      recommendedStrategy = atRiskItemIds.length ? "indoorSwap" : "monitor";
      severity = event.type === "HEAVY_RAIN" ? "warning" : event.severity;
      pushOption({ label: "换成室内方案", detail: "把受影响户外站点替换为博物馆/展览等室内候选", strategy: "indoorSwap" });
      pushOption({ label: "压缩户外停留", detail: "保留户外但缩短停留并加雨具缓冲", strategy: "shift" });
      break;
    }
    case "EXTREME_HEAT": {
      const startDate = new Date(Date.parse(event.effectiveFrom ?? event.occurredAt) + 8 * 60 * 60_000).toISOString().slice(0, 10);
      for (const itemId of itemsOfTripOnDate(trip, startDate)) {
        const item = trip.items.find((candidate) => candidate.id === itemId);
        const startClock = item ? clockMinutesOf(item.startTime) : null;
        if (item && startClock !== null && startClock >= 11 * 60 && startClock <= 15 * 60 && isOutdoorPlace(trip, item.placeId)) {
          atRiskItemIds.push(item.id);
          pushItem(item.id, "正午高温户外安排");
        }
      }
      recommendedStrategy = atRiskItemIds.length ? "shift" : "monitor";
      severity = "warning";
      pushOption({ label: "避开正午", detail: "把正午户外安排移到早晚时段", strategy: "shift" });
      break;
    }
    case "POI_CLOSED": {
      const placeId = idsFromEntities(event, ["place"])[0]
        ?? (typeof event.payload.placeId === "string" ? event.payload.placeId : undefined);
      if (!placeId) {
        unknowns.push("事件未提供关闭地点（placeId），无法定位受影响行程");
        break;
      }
      for (const item of trip.items.filter((candidate) => candidate.status === "planned")) {
        if (item.placeId !== placeId) continue;
        if (typeof event.payload.reopeningAt === "string" || event.effectiveUntil) {
          atRiskItemIds.push(item.id);
          pushItem(item.id, "临时关闭");
        } else {
          impossibleItemIds.push(item.id);
          pushItem(item.id, "无限期关闭");
        }
      }
      if (!atRiskItemIds.length && !impossibleItemIds.length) unknowns.push("关闭地点不在当前行程中");
      recommendedStrategy = impossibleItemIds.length ? "replace" : atRiskItemIds.length ? "shift" : "monitor";
      severity = atRiskItemIds.length || impossibleItemIds.length ? "warning" : "info";
      pushOption({ label: "寻找替代地点", detail: "用同类别候选替换关闭的地点", strategy: "replace" });
      pushOption({ label: "顺移到重新开放后", detail: "把该站点移到 effectiveUntil 之后", strategy: "shift" });
      break;
    }
    case "OPENING_HOURS_CHANGED": {
      const placeId = idsFromEntities(event, ["place"])[0]
        ?? (typeof event.payload.placeId === "string" ? event.payload.placeId : undefined);
      const newHours = typeof event.payload.openingHours === "string" ? event.payload.openingHours : undefined;
      if (!placeId) unknowns.push("事件未提供地点（placeId）");
      if (!newHours) unknowns.push("事件未提供新的营业时间（openingHours）");
      if (placeId && newHours) {
        const match = newHours.match(/(\d{1,2}):(\d{2})\s*[-–~至]\s*(\d{1,2}):(\d{2})/);
        if (match) {
          const opens = Number(match[1]) * 60 + Number(match[2]);
          for (const item of trip.items.filter((candidate) => candidate.placeId === placeId && candidate.status === "planned")) {
            const startClock = clockMinutesOf(item.startTime);
            if (startClock !== null && startClock < opens) {
              atRiskItemIds.push(item.id);
              pushItem(item.id, `早于新开门时间 ${match[1]}:${match[2]}`);
            }
          }
        } else {
          unknowns.push(`无法解析营业时间格式：${newHours}`);
        }
      }
      recommendedStrategy = atRiskItemIds.length ? "shift" : "monitor";
      pushOption({ label: "顺延到开门后", detail: "把受影响站点移到新营业时间内", strategy: "shift" });
      break;
    }
    case "ROAD_CONGESTED":
    case "ROUTE_CLOSED": {
      const segmentId = idsFromEntities(event, ["segment"])[0]
        ?? (typeof event.payload.segmentId === "string" ? event.payload.segmentId : undefined);
      const segments = segmentId
        ? trip.segments.filter((candidate) => candidate.id === segmentId)
        : trip.segments.filter((candidate) => candidate.dayId === (resolvedState.currentDay?.dayId ?? ""));
      for (const segment of segments) {
        affectedEntities.push({ kind: "segment", id: segment.id, label: `${segment.label || segment.mode}`, relation: event.type === "ROUTE_CLOSED" ? "道路封闭" : "道路拥堵" });
        const nextItem = segment.toItemId;
        if (nextItem && trip.items.some((candidate) => candidate.id === nextItem)) {
          atRiskItemIds.push(nextItem);
          pushItem(nextItem, "在途时间受影响");
        }
      }
      if (!segments.length) unknowns.push("未找到受影响的路段");
      recommendedStrategy = atRiskItemIds.length ? "swapMode" : "monitor";
      severity = "warning";
      pushOption({ label: "更换交通方式", detail: "把受影响路段切换为地铁或打车", strategy: "swapMode" });
      break;
    }
    case "RESERVATION_CANCELLED": {
      const reservationId = idsFromEntities(event, ["reservation"])[0]
        ?? (typeof event.payload.reservationId === "string" ? event.payload.reservationId : undefined);
      const reservation = (trip.reservations ?? []).find((candidate) => candidate.id === reservationId);
      if (!reservation) {
        unknowns.push("事件未关联可识别的预订");
        break;
      }
      affectedEntities.push({ kind: "reservation", id: reservation.id, label: reservation.title, relation: "已取消的预订，时间窗释放" });
      if (reservation.linkedItemId) {
        recoverableItemIds.push(reservation.linkedItemId);
        pushItem(reservation.linkedItemId, "随预订取消释放，可重新安排");
      }
      recommendedStrategy = "release";
      pushOption({ label: "重新安排该时段", detail: "用释放的时间窗安排替代活动或休息", strategy: "release" });
      break;
    }
    case "RESERVATION_CHANGED": {
      const reservationId = idsFromEntities(event, ["reservation"])[0]
        ?? (typeof event.payload.reservationId === "string" ? event.payload.reservationId : undefined);
      const reservation = (trip.reservations ?? []).find((candidate) => candidate.id === reservationId);
      if (!reservation) {
        unknowns.push("事件未关联可识别的预订");
        break;
      }
      affectedEntities.push({ kind: "reservation", id: reservation.id, label: reservation.title, relation: "已变更的预订" });
      const newStart = typeof event.payload.newStartAt === "string" ? event.payload.newStartAt : undefined;
      if (newStart) timeDeltaMinutes = Math.round((Date.parse(newStart) - Date.parse(reservation.startAt)) / 60_000);
      else unknowns.push("事件未提供 newStartAt，无法量化时间变化");
      recommendedStrategy = "shift";
      severity = "warning";
      pushOption({ label: "按新时间重排", detail: "以变更后的预订时间为锚重新评估当日安排", strategy: "shift" });
      break;
    }
    case "USER_LATE": {
      const minutes = numbersFromPayload(event, ["minutes", "lateMinutes"]) ?? resolvedState.lateByMinutes ?? 0;
      timeDeltaMinutes = minutes;
      severity = minutes > 60 ? "critical" : minutes > 15 ? "warning" : "info";
      const todayItemIds = resolvedState.currentDay
        ? itemsOfTripOnDate(trip, resolvedState.currentDay.date)
        : [];
      // Confirmed reservations today are protected — never offered as skippable.
      const protectedByReservation = new Set(
        (trip.reservations ?? [])
          .filter((candidate) => candidate.status === "confirmed" && candidate.linkedItemId)
          .map((candidate) => candidate.linkedItemId!),
      );
      const trailing = todayItemIds.filter((itemId) => !protectedByReservation.has(itemId));
      for (const itemId of trailing) {
        atRiskItemIds.push(itemId);
        pushItem(itemId, minutes > 0 ? `晚点 ${minutes} 分钟后的今日安排` : "今日安排");
      }
      if (trailing.length >= 2) {
        recoverableItemIds.push(trailing[trailing.length - 1]);
        pushOption({ label: "跳过最后一站", detail: `放弃「${itemLabel(trip, trailing[trailing.length - 1])}」，减少连锁延误`, strategy: "skip" });
      }
      if (minutes > 15) pushOption({ label: "压缩停留", detail: "后续站点各压缩停留时长，赶上原计划", strategy: "shift" });
      recommendedStrategy = minutes > 15 ? (trailing.length >= 2 ? "skip" : "shift") : "monitor";
      break;
    }
    case "USER_AHEAD": {
      severity = "info";
      recommendedStrategy = "monitor";
      pushOption({ label: "提前下一站", detail: "比计划提前，可考虑提前出发或加入顺路站点", strategy: "shift" });
      break;
    }
    case "WALKING_OVERLOAD": {
      const dayId = resolvedState.currentDay?.dayId;
      if (dayId) {
        for (const segment of trip.segments.filter((candidate) => candidate.dayId === dayId && candidate.mode === "walk")) {
          walkingDeltaMeters += segment.distanceMeters ?? segment.meters ?? 0;
          affectedEntities.push({ kind: "segment", id: segment.id, label: segment.label || "步行段", relation: "步行负担" });
        }
      } else {
        unknowns.push("当前没有进行中的日期，无法定位步行段");
      }
      recommendedStrategy = "reduceWalking";
      severity = "warning";
      pushOption({ label: "长步行换交通", detail: "超过 1 公里的步行段切换为地铁/打车", strategy: "reduceWalking" });
      break;
    }
    case "BUDGET_THRESHOLD": {
      budgetDelta = Math.max(0, -(resolvedState.budgetState.remaining));
      severity = budgetDelta > 0 ? "warning" : "info";
      recommendedStrategy = budgetDelta > 0 ? "reduceBudget" : "monitor";
      pushOption({ label: "削减弹性支出", detail: `当前预估已 ${budgetDelta > 0 ? `超预算 ¥${budgetDelta}` : "接近预算"}，优先压缩交通与购物`, strategy: "reduceBudget" });
      break;
    }
    case "TRIP_CONSTRAINT_VIOLATED": {
      severity = "critical";
      recommendedStrategy = resolvedState.constraintViolations.length ? "shift" : "monitor";
      for (const violation of resolvedState.constraintViolations) {
        affectedEntities.push({ kind: "day", id: "constraints", label: violation, relation: "违反约束" });
      }
      if (resolvedState.constraintViolations.length) {
        pushOption({ label: "修复约束冲突", detail: "按约束引擎提示重排行程", strategy: "shift" });
      }
      break;
    }
  }

  // Severity floor from the event itself, ceiling from detected impact.
  if (impossibleItemIds.length > 0) severity = "critical";

  const parts: string[] = [];
  if (timeDeltaMinutes > 0) parts.push(`时间影响约 ${timeDeltaMinutes} 分钟`);
  if (atRiskItemIds.length) parts.push(`${atRiskItemIds.length} 个安排受影响`);
  if (impossibleItemIds.length) parts.push(`${impossibleItemIds.length} 个安排无法按原计划进行`);
  if (walkingDeltaMeters > 0) parts.push(`涉及步行约 ${(walkingDeltaMeters / 1000).toFixed(1)} km`);
  if (budgetDelta > 0) parts.push(`预估超支 ¥${budgetDelta}`);
  if (!parts.length) parts.push(unknowns.length ? "影响范围待确认" : "未检测到行程层面的影响");

  return {
    eventType: event.type,
    severity,
    affectedEntities,
    atRiskItemIds,
    impossibleItemIds,
    recoverableItemIds,
    constraintViolations,
    timeDeltaMinutes,
    budgetDelta,
    walkingDeltaMeters,
    recommendedStrategy,
    summary: parts.join("，") + "。",
    options,
    unknowns,
  };
}
