import "server-only";
import type { Trip } from "@/types/travel";
import { chatJson, getLlmConfig } from "../llm";
import { travelActionListSchema, type TravelActionList } from "./schemas";
import { planActionsWithRules } from "./rule-planner";

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
  '- CHANGE_ROUTE_MODE: {"segmentId"?, "fromItemId"?, "toItemId"?, "dayId"?, "newMode": "walk"|"metro"|"taxi"|"bus"|"drive"}',
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

function ruleBasedActions(trip: Trip, message: string): TravelActionList {
  return planActionsWithRules(trip, message);
}

import { buildWeatherContext } from "@/services/weather/context";

function buildUserMessage(trip: Trip, message: string) {
  const candidates = trip.places
    .filter((p) => !trip.items.some((i) => i.placeId === p.id))
    .map((p) => `${p.id} ${p.name}(${p.category})`)
    .join("、");
  const weatherCtx = buildWeatherContext(trip);
  const weatherSummary = weatherCtx.days
    .map(
      (d) =>
        `Day ${d.dayIndex + 1} (${d.date}): ${d.tempC}°C ${d.condition}${
          d.isRainy ? " [预计有雨/建议室内方案]" : ""
        }${d.isExtremeHeat ? " [高温避暑]" : ""}`,
    )
    .join("; ");

  return [
    "当前行程（itemId/dayId/placeId 都要引用这里的）：",
    tripSummary(trip),
    "",
    `目的地实时天气情报：${weatherSummary}。建议：${weatherCtx.generalAdvisory}`,
    "",
    `当前预算与支出状态：总预算 ¥${trip.budget}，当前预估支出 ¥${trip.estimatedSpend}`,
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
