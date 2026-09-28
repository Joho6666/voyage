import { z } from "zod";
import { getLlmConfig, chatJson, type ChatMessage } from "@/services/ai/llm";
import { planWithRules } from "./rule-planner";
import { MAX_TRIP_DAYS } from "@/skill/contracts";
import type { Place } from "@/types/travel";
import type { SocialSignal } from "@/services/social/types";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");

export const outlineSchema = z.object({
  title: z.string().min(1).max(60),
  dayPlans: z.array(z.object({
    title: z.string().max(40),
    summary: z.string().max(120),
    stops: z.array(z.object({
      placeId: z.string().min(1),
      startTime: hhmm,
      durationMinutes: z.number().int().min(15).max(480),
      meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
    })).min(1).max(10),
  })).min(1).max(MAX_TRIP_DAYS),
  tasks: z.array(z.object({ title: z.string().min(1).max(60), group: z.enum(["before", "day"]) })).max(16).optional(),
});

export type Outline = z.output<typeof outlineSchema>;

export interface OutlinePlanningInput {
  prompt: string;
  destination: string;
  candidates: Place[];
  startDate: string;
  endDate: string;
  budget: number;
  travelers: number;
  vibes: string[];
  social?: { signals: SocialSignal[] };
}

export interface OutlinePlanningResult {
  outline: Outline;
  source: "llm" | "rules";
  llm: "used" | "unavailable" | "failed" | "skipped";
  fallbackReason?: string;
}

const SYSTEM_PROMPT = [
  "你是 Voyage 旅行规划器。根据用户需求，把候选地点排成每天可执行的行程。",
  '输出严格 JSON：{"title": "...", "dayPlans": [{"title", "summary", "stops": [{"placeId", "startTime": "HH:mm", "durationMinutes", "meal"?}]}], "tasks": [{"title", "group": "before"|"day"}]}',
  "规则：",
  "1. placeId 只能来自候选列表；绝不发明地点、坐标、价格或库存。",
  "2. 每天按地理就近排序，行程节奏参考用户偏好（轻松/特种兵）。",
  "3. 一天安排 1-4 个 stops，并尽量包含正餐（meal: lunch/dinner）。",
  "4. startTime 用 24 小时 HH:mm；不能安排超出当天合理时段的行程。",
  "5. 社交平台信号仅作攻略参考，不能替代高德地点事实或票务库存。",
].join("\n");

function dayCount(startDate: string, endDate: string) {
  return Math.max(1, Math.min(MAX_TRIP_DAYS, Math.floor((new Date(`${endDate}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86_400_000) + 1));
}

function ruleOutline(input: OutlinePlanningInput): Outline {
  return {
    ...planWithRules({
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
      travelers: input.travelers,
      budget: input.budget,
      vibes: input.vibes,
      candidates: input.candidates,
    }),
    tasks: [],
  };
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "LLM outline failed";
  return message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]").slice(0, 240);
}

async function llmOutline(input: OutlinePlanningInput): Promise<Outline> {
  const candidateLines = input.candidates
    .map((place) => `${place.id} ${place.name} [${place.category}] (${place.district || place.address})`)
    .join("\n");
  const expectedDays = dayCount(input.startDate, input.endDate);
  const userMessage = [
    `用户需求：${input.prompt}`,
    `天数：${expectedDays}，人数：${input.travelers}，预算：¥${input.budget}`,
    input.vibes.length ? `偏好：${input.vibes.join("、")}` : "",
    "",
    "候选地点：",
    candidateLines,
    input.social?.signals.length ? "\n社交平台信号（仅作参考，不得创建候选地点或替代实时事实）：" : "",
    ...(input.social?.signals ?? []).map((signal) => `${signal.signalType}=${JSON.stringify(signal.value)} confidence=${signal.confidence.toFixed(2)} sources=${signal.sources.length}`),
    "",
    // The traveller's earlier words can state a different length than the dates
    // they finally confirmed ("玩3天" then picking a 4-day window). The date pair
    // is the decision of record, so say so instead of leaving the model to guess.
    `注意：本次行程必须是 ${expectedDays} 天，dayPlans 必须恰好 ${expectedDays} 项。用户需求里若出现别的天数说法，那是确认日期之前的旧说法，一律以 ${expectedDays} 天为准。`,
  ].filter(Boolean).join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
  const candidateIds = new Set(input.candidates.map((candidate) => candidate.id));
  let lastError = "LLM outline failed";

  // One corrective retry: a model that miscounts days usually fixes it when told
  // what it returned, and a silent fallback would hide the real reason.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = outlineSchema.safeParse(await chatJson({ messages, maxTokens: 3500 }));
    if (!parsed.success) {
      lastError = "LLM outline failed schema validation";
      continue;
    }
    const referencesOnlyCandidates = parsed.data.dayPlans.every((day) =>
      day.stops.every((stop) => candidateIds.has(stop.placeId)),
    );
    if (!referencesOnlyCandidates) {
      lastError = "LLM outline referenced a place outside provider candidates";
      continue;
    }
    if (parsed.data.dayPlans.length !== expectedDays) {
      const returned = parsed.data.dayPlans.length;
      lastError = `LLM outline returned ${returned} days; expected ${expectedDays}`;
      messages.push({ role: "assistant", content: JSON.stringify(parsed.data) });
      messages.push({
        role: "user",
        content: `你上次返回了 ${returned} 天，但这次旅行是 ${expectedDays} 天（${input.startDate} 至 ${input.endDate}）。请重新输出恰好 ${expectedDays} 项 dayPlans 的完整 JSON，placeId 仍然只能来自候选列表。`,
      });
      continue;
    }
    return parsed.data;
  }
  throw new Error(lastError);
}

/** LLM selects and orders provider candidates; deterministic rules remain the fallback. */
export async function planOutline(input: OutlinePlanningInput): Promise<OutlinePlanningResult> {
  if (process.env.VOYAGE_LLM_ENABLED === "0" || process.env.NODE_ENV === "test") {
    return { outline: ruleOutline(input), source: "rules", llm: "skipped", fallbackReason: "当前运行环境未调用外部 LLM" };
  }
  if (!getLlmConfig()) {
    return { outline: ruleOutline(input), source: "rules", llm: "unavailable", fallbackReason: "LLM_BASE_URL 未配置" };
  }
  try {
    return { outline: await llmOutline(input), source: "llm", llm: "used" };
  } catch (error) {
    return { outline: ruleOutline(input), source: "rules", llm: "failed", fallbackReason: safeErrorMessage(error) };
  }
}
