import type { Trip } from "@/types/travel";
import type { TravelAction } from "./types";

export interface RuleActionPlan {
  actions: TravelAction[];
  summary: string;
}

function amountFrom(text: string) {
  const matched = text.match(/(?:省|减少|降低)?\s*(\d{2,6})\s*(?:元|块)?/);
  const value = matched ? Number(matched[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 300;
}

/** Resolve explicit day references without relying on an LLM. */
export function resolveRequestedDay(trip: Trip, instruction: string, fallbackDayId?: string) {
  const explicitId = instruction.match(/\[dayId:([^\]]+)\]/)?.[1];
  if (explicitId && trip.days.some((day) => day.id === explicitId)) return explicitId;

  const normalized = instruction.toLowerCase();
  const digit = normalized.match(/(?:day\s*|第\s*)([1-7一二三四五六七])\s*(?:天|日)?/i)?.[1];
  const chinese: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };
  const index = digit ? (chinese[digit] ?? Number(digit)) - 1 : -1;
  if (index >= 0 && trip.days[index]) return trip.days[index].id;

  if (fallbackDayId && trip.days.some((day) => day.id === fallbackDayId)) return fallbackDayId;
  return trip.days[0]?.id;
}

/** Deterministic natural-language-to-TravelAction adapter used when no LLM is configured. */
export function planActionsWithRules(trip: Trip, instruction: string, fallbackDayId?: string): RuleActionPlan {
  const text = instruction.trim();
  const dayId = resolveRequestedDay(trip, text, fallbackDayId);
  if (!dayId) return { actions: [], summary: text };

  let actions: TravelAction[];
  if (text.includes("雨") || text.includes("室内")) {
    actions = [{ type: "RAIN_PLAN", payload: { dayId, preferIndoor: true } }];
  } else if (text.includes("推迟") || text.includes("延后") || text.includes("晚点")) {
    actions = [{ type: "DELAY_DAY", payload: { dayId, minutes: 60 } }];
  } else if (text.includes("提前") || text.includes("早点")) {
    actions = [{ type: "START_EARLIER", payload: { dayId, minutes: 30 } }];
  } else if (text.includes("跳过")) {
    actions = [{ type: "SKIP_NEXT", payload: { dayId } }];
  } else if (text.includes("省") || text.includes("预算")) {
    actions = [{ type: "REDUCE_TODAY_BUDGET", payload: { dayId, targetSaveAmount: amountFrom(text) } }];
  } else if (text.includes("走") || text.includes("累") || text.includes("轻松")) {
    actions = [
      { type: "OPTIMIZE_DAY", payload: { dayId } },
      { type: "REDUCE_WALKING", payload: { dayId } },
    ];
  } else if (text.includes("换")) {
    actions = [{ type: "CHANGE_NEXT_PLACE", payload: { dayId } }];
  } else if (text.includes("吃") || text.includes("美食")) {
    actions = [{ type: "FIND_NEARBY_FOOD", payload: { dayId } }];
  } else {
    actions = [{ type: "OPTIMIZE_DAY", payload: { dayId } }];
  }
  return { actions, summary: text };
}
