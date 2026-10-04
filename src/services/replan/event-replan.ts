import type { TravelEvent } from "@/schemas/travel-event";
import type { TripState } from "@/schemas/trip-state";
import type { Trip } from "@/types/travel";
import type { TravelAction } from "@/services/ai/actions/types";
import type { ImpactResult } from "@/services/impact-engine";

/**
 * Event-driven replan (Phase 6.6).
 *
 * Translates an ImpactResult into deterministic TravelActions that the
 * existing executor can apply through the normal proposal pipeline. The LLM
 * is not involved: the strategy comes from the impact engine (or the caller
 * picking one of its options), and every action must survive the guardrails
 * below — confirmed reservations, done/current items and the Diff/apply
 * safety chain are never bypassed.
 */

export type ReplanStrategy =
  | "auto" | "shift" | "skip" | "indoorSwap" | "replace"
  | "release" | "reduceWalking" | "reduceBudget" | "swapMode" | "monitor";

const RESERVATION_LINKED = (trip: Trip, itemId: string) =>
  (trip.reservations ?? []).some(
    (reservation) => reservation.linkedItemId === itemId && (reservation.status === "confirmed" || reservation.status === "completed"),
  );

function dayIdOfItem(trip: Trip, itemId: string): string | undefined {
  return trip.items.find((item) => item.id === itemId)?.dayId;
}

function replacementFor(trip: Trip, itemId: string): string | undefined {
  const item = trip.items.find((candidate) => candidate.id === itemId);
  if (!item) return undefined;
  const scheduled = new Set(trip.items.map((existing) => existing.placeId));
  return trip.places
    .filter((place) =>
      place.id !== item.placeId &&
      !scheduled.has(place.id) &&
      (place.category === "attraction" || place.category === "activity" || place.category === "viewpoint"))
    .sort((a, b) => b.rating - a.rating)[0]?.id;
}

export interface EventReplanPlan {
  actions: TravelAction[];
  notes: string[];
}

/**
 * ImpactResult → concrete actions for one strategy. Pure: no repository, no
 * provider, no clock. Empty `actions` means "nothing safe to execute for this
 * strategy" — the caller reports that instead of forcing a change.
 */
export function actionsFromImpact(
  impact: ImpactResult,
  trip: Trip,
  strategy: Exclude<ReplanStrategy, "auto">,
  state: TripState,
): EventReplanPlan {
  const actions: TravelAction[] = [];
  const notes: string[] = [];
  const plannedItems = new Set(trip.items.filter((item) => item.status === "planned").map((item) => item.id));
  const droppable = (itemId: string) => plannedItems.has(itemId) && !RESERVATION_LINKED(trip, itemId);

  switch (strategy) {
    case "skip": {
      const candidates = [...impact.recoverableItemIds, ...impact.atRiskItemIds].filter(droppable);
      const target = candidates[candidates.length - 1];
      if (target) {
        actions.push({ type: "REMOVE_ITEM", payload: { itemId: target } });
        notes.push(`跳过「${trip.places.find((place) => place.id === trip.items.find((item) => item.id === target)?.placeId)?.name ?? target}」`);
      } else {
        notes.push("没有可安全跳过的站点（受保护预订或非计划状态）");
      }
      break;
    }
    case "shift": {
      if (impact.timeDeltaMinutes > 0 && (impact.eventType === "FLIGHT_DELAYED" || impact.eventType === "TRAIN_DELAYED" || impact.eventType === "RESERVATION_CHANGED")) {
        const anchorItem = [...impact.impossibleItemIds, ...impact.atRiskItemIds].find((itemId) => dayIdOfItem(trip, itemId));
        const dayId = anchorItem ? dayIdOfItem(trip, anchorItem) : state.currentDay?.dayId;
        if (dayId) {
          actions.push({ type: "DELAY_DAY", payload: { dayId, minutes: impact.timeDeltaMinutes } });
          notes.push(`当日安排整体顺延 ${impact.timeDeltaMinutes} 分钟`);
        } else {
          notes.push("无法确定受影响的日期");
        }
      } else if (impact.eventType === "USER_LATE") {
        // Compress up to two trailing planned stops by 20 minutes each.
        const compressible = impact.atRiskItemIds.filter(droppable).slice(0, 2);
        for (const itemId of compressible) {
          actions.push({ type: "SHORTEN_STAY", payload: { itemId, reduceMinutes: 20 } });
        }
        if (compressible.length) notes.push(`压缩 ${compressible.length} 个站点停留各 20 分钟`);
        else notes.push("没有可压缩的计划站点");
      } else {
        notes.push("该事件没有量化的顺移依据，未自动调整时间");
      }
      break;
    }
    case "indoorSwap": {
      const anchorItem = [...impact.atRiskItemIds, ...impact.impossibleItemIds].find((itemId) => dayIdOfItem(trip, itemId));
      const dayId = anchorItem ? dayIdOfItem(trip, anchorItem) : state.currentDay?.dayId;
      if (dayId) {
        actions.push({ type: "RAIN_PLAN", payload: { dayId, preferIndoor: true } });
        notes.push("执行雨天预案：室外换室内并压缩长步行");
      } else {
        notes.push("无法确定受影响的日期");
      }
      break;
    }
    case "replace": {
      const targets = [...impact.impossibleItemIds, ...impact.atRiskItemIds].filter(droppable);
      if (!targets.length) {
        notes.push("没有可替换的计划站点");
        break;
      }
      for (const itemId of targets.slice(0, 2)) {
        const placeId = replacementFor(trip, itemId);
        if (placeId) {
          actions.push({ type: "REPLACE_ITEM", payload: { itemId, placeId } });
          notes.push(`替换为「${trip.places.find((place) => place.id === placeId)?.name ?? placeId}」`);
        } else {
          notes.push("候选地点中找不到可验证的替代（不引入新地点）");
        }
      }
      break;
    }
    case "release": {
      const anchorItem = impact.recoverableItemIds.find((itemId) => dayIdOfItem(trip, itemId));
      const dayId = anchorItem ? dayIdOfItem(trip, anchorItem) : state.currentDay?.dayId;
      if (dayId) {
        actions.push({ type: "OPTIMIZE_DAY", payload: { dayId } });
        notes.push("释放的时间窗按就近原则重排当日");
      } else {
        notes.push("释放的时间窗没有对应行程日");
      }
      break;
    }
    case "reduceWalking": {
      const dayId = state.currentDay?.dayId ?? impact.atRiskItemIds.map((itemId) => dayIdOfItem(trip, itemId)).find(Boolean);
      if (dayId) {
        actions.push({ type: "REDUCE_TODAY_WALKING", payload: { dayId } });
        notes.push("长步行段切换为地铁/打车");
      } else {
        notes.push("无法确定步行超载的日期");
      }
      break;
    }
    case "reduceBudget": {
      const dayId = state.currentDay?.dayId ?? trip.days[0]?.id;
      const amount = impact.budgetDelta > 0 ? Math.min(500, Math.max(50, impact.budgetDelta)) : 100;
      if (dayId) {
        actions.push({ type: "REDUCE_TODAY_BUDGET", payload: { dayId, targetSaveAmount: amount } });
        notes.push(`按 ¥${amount} 目标压缩今日弹性支出`);
      }
      break;
    }
    case "swapMode": {
      const segmentIds = impact.affectedEntities.filter((entity) => entity.kind === "segment").map((entity) => entity.id);
      if (!segmentIds.length) {
        notes.push("没有受影响路段可切换");
        break;
      }
      for (const segmentId of segmentIds.slice(0, 2)) {
        actions.push({ type: "CHANGE_ROUTE_MODE", payload: { segmentId, newMode: "metro" } });
      }
      notes.push("受影响路段切换为地铁");
      break;
    }
    case "monitor":
    default:
      notes.push("该事件仅需关注，未生成修改动作");
      break;
  }

  return { actions, notes };
}
