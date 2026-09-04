import "server-only";
import type { Trip } from "@/types/travel";
import { chatJson, getLlmConfig } from "../llm";
import { travelActionListSchema, type TravelActionList } from "./schemas";
import type { TravelAction } from "./types";

function tripSummary(trip: Trip) {
  const lines: string[] = [];
  trip.days.forEach((day) => {
    lines.push(`Day ${day.index + 1} (${day.id}, ${day.date}, weather ${day.weather.condition}):`);
    trip.items
      .filter((item) => item.dayId === day.id)
      .sort((a, b) => a.order - b.order)
      .forEach((item) => {
        const place = trip.places.find((p) => p.id === item.placeId);
        const name = place ? place.name : item.placeId;
        lines.push(`  - ${item.id} ${item.startTime} ${name} (${item.type}, ${item.duration}min)`);
      });
  });
  return lines.join("\n");
}

const SYSTEM_PROMPT = [
  "你是 Voyage 的行程规划器。用户会用自然语言要求修改旅行计划。",
  '你必须输出严格的 JSON 对象：{"actions": [...], "summary": "..."}',
  'actions 数组中的每个元素是 {"type": <ACTION_TYPE>, "payload": {...}}。',
  "",
  "可用 ACTION_TYPE 和 payload：",
  '- MOVE_ITEM / CHANGE_DAY: {"itemId", "toDayId", "order"?}',
  '- REMOVE_ITEM: {"itemId"}',
  '- ADD_ITEM: {"placeId", "dayId", "startTime"?, "durationMinutes"?}',
  '- REPLACE_ITEM: {"itemId", "placeId"}',
  '- OPTIMIZE_DAY: {"dayId"}',
  '- REDUCE_WALKING: {"dayId"?}',
  '- REDUCE_BUDGET: {"amount", "reason"?}',
  '- CHANGE_TRANSPORT: {"itemId"?, "dayId"?, "mode": "walk"|"metro"|"taxi"|"bus"|"drive"}',
  '- RECOMMEND_FOOD: {"dayId"?}',
  '- RECOMMEND_PLACES: {"dayId"?}',
  '- CHANGE_TIME: {"itemId", "startTime": "HH:mm"}',
  '- RAIN_PLAN: {"dayId"?}',
  '- DELAY_DAY: {"dayId", "minutes": 60}',
  '- START_EARLIER: {"dayId", "minutes": 30}',
  '- SKIP_NEXT: {"dayId", "currentItemId"?}',
  '- FIND_NEARBY_FOOD: {"dayId", "cuisine"?}',
  '- REDUCE_TODAY_WALKING: {"dayId", "maxWalkMeters"?}',
  '- REDUCE_TODAY_BUDGET: {"dayId", "targetSaveAmount": 100}',
  '- CHANGE_NEXT_PLACE: {"dayId"?, "currentItemId"?, "category"?}',
  '- CHANGE_ROUTE_MODE: {"dayId"?, "mode": "walk"|"metro"|"taxi"|"bus"|"drive"}',
  '- MOVE_INDOOR: {"dayId"}',
  '- EXTEND_STAY: {"itemId", "additionalMinutes"}',
  '- SHORTEN_STAY: {"itemId", "reduceMinutes"}',
  "",
  "规则：",
  "1. 只能引用下方行程清单里存在的 itemId / dayId。",
  "2. ADD/REPLACE 的 placeId 必须来自候选地点列表；没有合适的就输出 RECOMMEND_*。",
  "3. 用户喊累/想省力 → REDUCE_WALKING 或 REDUCE_TODAY_WALKING（必要时加 OPTIMIZE_DAY）。",
  "4. 用户提预算 → REDUCE_BUDGET 或 REDUCE_TODAY_BUDGET，amount 是具体数字。",
  "5. 用户指定时间 → CHANGE_TIME；用户指定某天 → MOVE_ITEM/CHANGE_DAY。",
  "6. 用户提到下雨/雨天预案 → RAIN_PLAN 或 MOVE_INDOOR。",
  "7. 用户提到推迟/晚起 → DELAY_DAY；跳过当前站 → SKIP_NEXT。",
  "8. 不要输出 JSON 以外的任何内容。",
].join("\n");

export function isLlmConfigured() {
  return Boolean(getLlmConfig());
}

function extractAmount(text: string) {
  const matched = text.match(/(\d{3,5})/);
  const value = matched ? Number(matched[1]) : NaN;
  return Number.isFinite(value) && value >= 100 ? value : 300;
}

function ruleBasedActions(trip: Trip, message: string): TravelActionList {
  const text = message.trim();
  const day1 = trip.days[0];
  const day2 = trip.days[1] ?? day1;
  const currentDayId = day1?.id ?? "day-1";
  const actions: TravelAction[] = [];

  if (text.includes("雨") || text.includes("下雨")) {
    actions.push({ type: "RAIN_PLAN", payload: { dayId: day2?.id ?? currentDayId } });
  } else if (text.includes("推迟") || text.includes("延后")) {
    actions.push({ type: "DELAY_DAY", payload: { dayId: currentDayId, minutes: 60 } });
  } else if (text.includes("提前") || text.includes("早点")) {
    actions.push({ type: "START_EARLIER", payload: { dayId: currentDayId, minutes: 30 } });
  } else if (text.includes("跳过")) {
    actions.push({ type: "SKIP_NEXT", payload: { dayId: currentDayId } });
  } else if (text.includes("省100") || (text.includes("省") && text.includes("100"))) {
    actions.push({ type: "REDUCE_TODAY_BUDGET", payload: { dayId: currentDayId, targetSaveAmount: 100 } });
  } else if (text.includes("室内")) {
    actions.push({ type: "MOVE_INDOOR", payload: { dayId: currentDayId } });
  } else if (text.includes("换") || text.includes("换个地方")) {
    actions.push({ type: "CHANGE_NEXT_PLACE", payload: { dayId: currentDayId } });
  } else if (text.includes("赶") || text.includes("累") || text.toLowerCase().includes("day 2")) {
    if (day2) actions.push({ type: "OPTIMIZE_DAY", payload: { dayId: day2.id } });
    actions.push({ type: "REDUCE_WALKING", payload: { dayId: day2?.id } });
  } else if (text.includes("省") || text.includes("预算")) {
    actions.push({ type: "REDUCE_BUDGET", payload: { amount: extractAmount(text) } });
  } else if (text.includes("走") || text.includes("累")) {
    actions.push({ type: "REDUCE_WALKING", payload: { dayId: currentDayId } });
  } else if (text.includes("美食") || text.includes("吃")) {
    actions.push({ type: "FIND_NEARBY_FOOD", payload: { dayId: currentDayId } });
  } else if (text.includes("活动") || text.includes("夜")) {
    actions.push({ type: "RECOMMEND_PLACES", payload: { dayId: currentDayId } });
  } else {
    actions.push({ type: "OPTIMIZE_DAY", payload: { dayId: currentDayId } });
  }

  return { actions, summary: text };
}

function buildUserMessage(trip: Trip, message: string) {
  const candidates = trip.places
    .filter((p) => !trip.items.some((i) => i.placeId === p.id))
    .map((p) => `${p.id} ${p.name}(${p.category})`)
    .join("、");
  return [
    "当前行程（itemId/dayId/placeId 都要引用这里的）：",
    tripSummary(trip),
    "",
    "候选未加入地点：",
    candidates,
    "",
    `用户请求：${message}`,
  ].join("\n");
}

export async function planActions(
  trip: Trip,
  message: string,
): Promise<{ source: "llm" | "mock"; result: TravelActionList }> {
  if (!isLlmConfigured()) {
    return { source: "mock", result: ruleBasedActions(trip, message) };
  }
  try {
    const raw = await chatJson({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(trip, message) },
      ],
    });
    const parsed = travelActionListSchema.safeParse(raw);
    if (!parsed.success) {
      return { source: "mock", result: ruleBasedActions(trip, message) };
    }
    return { source: "llm", result: parsed.data };
  } catch {
    return { source: "mock", result: ruleBasedActions(trip, message) };
  }
}
