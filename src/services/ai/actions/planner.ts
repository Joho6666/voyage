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
  '- CHANGE_TRANSPORT: {"itemId"?, "dayId"?, "mode": "walk"|"metro"|"taxi"|"bus"}',
  '- RECOMMEND_FOOD: {"dayId"?}',
  '- RECOMMEND_PLACES: {"dayId"?}',
  '- CHANGE_TIME: {"itemId", "startTime": "HH:mm"}',
  "",
  "规则：",
  "1. 只能引用下方行程清单里存在的 itemId / dayId。",
  "2. ADD/REPLACE 的 placeId 必须来自候选地点列表；没有合适的就输出 RECOMMEND_*。",
  "3. 用户喊累/想省力 → REDUCE_WALKING（必要时加 OPTIMIZE_DAY）。",
  "4. 用户提预算 → REDUCE_BUDGET，amount 是具体数字。",
  "5. 用户指定时间 → CHANGE_TIME；用户指定某天 → MOVE_ITEM/CHANGE_DAY。",
  "6. 不要输出 JSON 以外的任何内容。",
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
  const day2 = trip.days[1];
  const actions: TravelAction[] = [];
  if (text.includes("赶") || text.includes("累") || text.toLowerCase().includes("day 2")) {
    if (day2) actions.push({ type: "OPTIMIZE_DAY", payload: { dayId: day2.id } });
    actions.push({ type: "REDUCE_WALKING", payload: {} });
  }
  if (text.includes("省") || text.includes("预算")) {
    actions.push({ type: "REDUCE_BUDGET", payload: { amount: extractAmount(text) } });
  }
  if (text.includes("走") || text.includes("累")) {
    actions.push({ type: "REDUCE_WALKING", payload: {} });
  }
  if (text.includes("美食") || text.includes("吃")) {
    actions.push({ type: "RECOMMEND_FOOD", payload: {} });
  }
  if (text.includes("活动") || text.includes("夜")) {
    actions.push({ type: "RECOMMEND_PLACES", payload: {} });
  }
  if (!actions.length) {
    actions.push({ type: "OPTIMIZE_DAY", payload: { dayId: trip.days[0]?.id ?? "" } });
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
