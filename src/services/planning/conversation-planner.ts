
import { randomUUID } from "node:crypto";
import { chatJson, getLlmConfig } from "@/services/ai/llm";
import { logger } from "@/lib/logger";
import {
  canonicalPlanningProfile,
  mergePlanningProfiles,
  missingPlanningFields,
} from "./profile";
import {
  MAX_PLANNING_MESSAGE_CHARS,
  planningBudgetModeSchema,
  planningMessageSchema,
  planningPaceSchema,
  planningProfilePatchSchema,
  planningTransportPreferenceSchema,
  planningWalkingToleranceSchema,
  type PlanningField,
  type PlanningMessage,
  type PlanningProfile,
  type PlanningProfilePatch,
} from "@/schemas/planning";
import { z } from "zod";

export {
  filterPlanningCandidates,
  isPlanningPlaceAvoided,
  isPlanningPlaceMustVisit,
  mergePlanningProfiles,
  missingPlanningFields,
  planningProfileToPrompt,
} from "./profile";

const llmTurnSchema = z
  .object({
    profilePatch: planningProfilePatchSchema.optional(),
    /** Accepting `profile` keeps the prompt usable with providers that use the shorter name. */
    profile: planningProfilePatchSchema.optional(),
    assistantMessage: z.string().trim().min(1).max(800).optional(),
    reply: z.string().trim().min(1).max(800).optional(),
    question: z.string().trim().max(240).nullable().optional(),
    nextQuestion: z.string().trim().max(240).nullable().optional(),
    ready: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.assistantMessage && !value.reply) {
      ctx.addIssue({ code: "custom", path: ["assistantMessage"], message: "assistantMessage is required" });
    }
    if (value.question !== undefined && value.nextQuestion !== undefined && value.question !== value.nextQuestion) {
      ctx.addIssue({ code: "custom", path: ["nextQuestion"], message: "question fields disagree" });
    }
  });

export interface ConversationPlannerInput {
  profile?: Partial<PlanningProfile> | PlanningProfilePatch;
  messages?: PlanningMessage[];
  /** Alias used by callers that call the history `history`. */
  history?: PlanningMessage[];
  message?: string;
}

export interface ConversationPlannerResult {
  profile: PlanningProfile;
  assistantMessage: PlanningMessage;
  /** At most one high-value question is returned for a turn. */
  question: string | null;
  ready: boolean;
  missing: PlanningField[];
  source: "llm" | "rules";
  llm: "used" | "unavailable" | "failed" | "skipped";
  fallbackReason?: string;
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "LLM conversation failed";
  return message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]").slice(0, 240);
}

function parseNumber(text: string) {
  const normalized = text.replace(/,/g, "").trim();
  const arabic = Number(normalized);
  if (Number.isFinite(arabic)) return arabic;
  const chinese: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (normalized.length === 1 && chinese[normalized] !== undefined) return chinese[normalized];
  if (normalized === "十") return 10;
  const ten = normalized.match(/^十([一二两三四五六七八九])$/);
  if (ten) return 10 + chinese[ten[1]]!;
  const beforeTen = normalized.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/);
  if (beforeTen) return chinese[beforeTen[1]]! * 10 + (beforeTen[2] ? chinese[beforeTen[2]]! : 0);
  return undefined;
}

function normalizeDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return undefined;
  const date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? undefined : date;
}

function extractDates(text: string) {
  const dates: string[] = [];
  for (const match of text.matchAll(/\b(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?\b/g)) {
    const date = normalizeDate(match[1], match[2], match[3]);
    if (date) dates.push(date);
  }
  const unique = [...new Set(dates)];
  return unique.length ? unique : undefined;
}

function splitList(value: string) {
  return value
    .replace(/[和及以及]/g, "、")
    .split(/[、,，；;\n]/)
    .map((part) => part.replace(/^(?:还有|包括|比如|例如)\s*/, "").replace(/[。.!！?？]+$/, "").trim())
    .filter((part) => part.length > 0 && part.length <= 80)
    .slice(0, 20);
}

function extractAfter(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match?.[1]) return [];
  return splitList(match[1]);
}

const KNOWN_VIBES = [
  "美食", "夜景", "自然", "摄影", "城市漫游", "文化", "历史", "购物", "咖啡", "亲子",
  "情侣", "独自旅行", "周末游", "轻松", "慢节奏", "特种兵", "户外", "小众", "海边", "温泉",
];
const DIETARY_TERMS = ["素食", "纯素", "清真", "不吃辣", "少辣", "不吃海鲜", "海鲜过敏", "过敏", "低糖", "无麸质"];

/**
 * Deterministic extraction used both as the no-LLM planner and as a guardrail
 * around LLM output.  It only records facts stated in the message.
 */
export function extractPlanningProfile(message: string): PlanningProfilePatch {
  const text = message.trim().slice(0, MAX_PLANNING_MESSAGE_CHARS);
  if (!text) return {};
  const patch: PlanningProfilePatch = {};

  const cleanDestination = (value: string) => value.replace(/(?:玩|旅游|旅行|看看|逛逛).*$/, "").trim();
  const route = text.match(/从\s*([^，,。；;!?！？\s]{1,40}?)(?:出发)?\s*(?:前往|去|到)\s*([^，,。；;!?！？\s]{1,40})/);
  if (route?.[1]) patch.origin = route[1].trim();
  if (route?.[2]) {
    const value = cleanDestination(route[2]);
    if (value) patch.destination = value;
  }

  if (!patch.origin) {
    const origin = text.match(/(?:出发地(?:是|为)?|起点(?:是|为)?)\s*([^，,。；;!?！？\s]{1,40})/);
    if (origin?.[1] && !/预算|目的地|哪里|什么时候/.test(origin[1])) patch.origin = origin[1].trim();
  }

  if (!patch.destination) {
    const destination = text.match(/(?:目的地(?:是|为)?|想去|计划去|去往|前往|去|到)\s*([^，,。；;!?！？\s]{1,40})/);
    if (destination?.[1] && !/哪里|时候|少走|走路/.test(destination[1])) {
      const value = cleanDestination(destination[1]);
      if (value) patch.destination = value;
    }
  }

  const dates = extractDates(text);
  if (dates?.[0]) patch.startDate = dates[0];
  if (dates?.[1]) patch.endDate = dates[1];

  const dayMatch = text.match(/(?<!\d)(\d+|[一二两三四五六七八九十]+)\s*(?:天|日)(?!后)/);
  const dayValue = dayMatch?.[1] ? parseNumber(dayMatch[1]) : undefined;
  if (dayValue && dayValue >= 1 && dayValue <= 31) patch.days = dayValue;

  const peopleMatch = text.match(/(?:一家|共|同行|我们有|有)?\s*(\d+|[一二两三四五六七八九十]+)\s*(?:个人|人|位|口)/);
  const familyMatch = text.match(/一家\s*(\d+|[一二两三四五六七八九十]+)\s*口/);
  const peopleValue = familyMatch?.[1] ?? peopleMatch?.[1];
  const travelers = peopleValue ? parseNumber(peopleValue) : undefined;
  if (travelers && travelers >= 1 && travelers <= 20) patch.travelers = travelers;

  const budgetMatch = text.match(/预算\s*(?:是|为|大概|约|在)?\s*[¥￥]?\s*([\d,.]+|[一二两三四五六七八九十]+)\s*(万|千|k|K|元)?/);
  if (budgetMatch?.[1]) {
    const base = parseNumber(budgetMatch[1]);
    if (base !== undefined) {
      const multiplier = budgetMatch[2] === "万" ? 10_000 : budgetMatch[2] === "千" || /k/i.test(budgetMatch[2] ?? "") ? 1_000 : 1;
      const budget = base * multiplier;
      if (budget >= 0 && budget <= 1_000_000) patch.budget = budget;
    }
  }

  if (/(?:轻松|悠闲|慢节奏|不赶|佛系|休闲)/.test(text)) patch.pace = "relaxed";
  else if (/(?:特种兵|紧凑|赶行程|多安排|暴走)/.test(text)) patch.pace = "packed";
  else if (/(?:适中|均衡|正常节奏)/.test(text)) patch.pace = "balanced";

  if (/(?:少走|少步行|不想走|不想多走|不想每天走|步行少|少爬坡|轮椅|走太多|走不动|走路太多)/.test(text)) patch.walkingTolerance = "low";
  else if (/(?:喜欢徒步|能走|多走|步行没问题|徒步)/.test(text)) patch.walkingTolerance = "high";
  else if (/(?:步行适中|正常步行)/.test(text)) patch.walkingTolerance = "medium";

  if (/(?:公共交通|公共交通为主|地铁公交|地铁为主|坐地铁)/.test(text)) patch.transportPreference = "public";
  else if (/(?:地铁)/.test(text)) patch.transportPreference = "metro";
  else if (/(?:公交)/.test(text)) patch.transportPreference = "bus";
  else if (/(?:打车|出租车|网约车|的士)/.test(text)) patch.transportPreference = "taxi";
  else if (/(?:自驾|开车)/.test(text)) patch.transportPreference = "drive";
  else if (/(?:走路|步行)/.test(text) && !patch.walkingTolerance) patch.transportPreference = "walk";

  const vibeMatches = KNOWN_VIBES.filter((vibe) => text.includes(vibe));
  if (vibeMatches.length) patch.vibes = vibeMatches;

  const mustVisit = extractAfter(text, /(?:一定要去|必去|必须去|想打卡|一定要打卡)\s*([^。！？!?\n]+)/);
  const mustVisitSuffix = [...text.matchAll(/([^，,。；;！？!?\n]{1,80}?)(?:一定要去|必去|必须去|想打卡|一定要打卡)/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const mergedMustVisit = [...mustVisit, ...mustVisitSuffix];
  if (mergedMustVisit.length) patch.mustVisit = mergedMustVisit;
  const avoid = extractAfter(text, /(?:不要去|不想去|避开|不去|不考虑)\s*([^。！？!?\n]+)/);
  if (avoid.length) patch.avoid = avoid;

  const dietary = DIETARY_TERMS.filter((term) => text.includes(term));
  if (dietary.length) patch.dietary = dietary;

  if (/(?:无障碍|轮椅|行动不便|电梯|不爬楼)/.test(text)) patch.accessibility = ["无障碍"];
  if (/(?:带孩子|有孩子|亲子|儿童|小朋友)/.test(text)) patch.children = true;
  if (/(?:带老人|有老人|老人同行|长辈|老年人)/.test(text)) patch.elderly = true;

  if (/(?:省钱|穷游|预算紧|经济型|尽量便宜)/.test(text)) patch.budgetMode = "tight";
  else if (/(?:舒适|不差钱|品质|宽松预算)/.test(text)) patch.budgetMode = "flexible";
  else if (/(?:性价比|预算适中|平衡预算)/.test(text)) patch.budgetMode = "balanced";

  if (/(?:参考|看看|结合).*(?:小红书|抖音|攻略|社交媒体|网友推荐)|(?:小红书|抖音|社交媒体).*(?:可以|同意|参考)/.test(text)) {
    patch.socialOptIn = true;
  } else if (/(?:不要|不想|不需要|关闭).*(?:小红书|抖音|社交媒体|社交攻略)/.test(text)) {
    patch.socialOptIn = false;
  }

  return planningProfilePatchSchema.parse(patch);
}

function deterministicQuestion(profile: PlanningProfile, missing: PlanningField[]) {
  const first = missing[0];
  switch (first) {
    case "destination": return "你想去哪个城市或目的地？";
    case "dates": return "你计划什么时候出发，或者准备玩几天？";
    case "travelers": return "这次有几位同行者？";
    case "budget": return "这次旅行的总预算大概是多少？";
    default: break;
  }
  if (!profile.pace) return "你更偏好轻松慢节奏，还是紧凑多安排一些？";
  if (!profile.walkingTolerance) return "你对步行的接受程度怎么样：少走、适中，还是可以多走？";
  return null;
}

function questionCount(text: string) {
  return (text.match(/[?？]/g) ?? []).length;
}

function validSingleQuestion(question: string | null | undefined) {
  if (!question) return null;
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > 240 || questionCount(trimmed) > 1) return undefined;
  return trimmed.endsWith("？") || trimmed.endsWith("?") ? trimmed : `${trimmed}？`;
}

function buildRuleResult(profile: PlanningProfile, reason: { llm: ConversationPlannerResult["llm"]; fallbackReason?: string }): ConversationPlannerResult {
  const missing = missingPlanningFields(profile);
  const question = missing.length ? deterministicQuestion(profile, missing) : deterministicQuestion(profile, []);
  const content = question
    ? `我先记下你的旅行偏好。${question}`
    : "关键信息已经齐了，可以继续生成一份不超出这些约束的行程。";
  const assistantMessage = planningMessageSchema.parse({
    id: randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  });
  return {
    profile,
    assistantMessage,
    question,
    ready: missing.length === 0,
    missing,
    source: "rules",
    ...reason,
  };
}

function llmEnabled() {
  if (process.env.VOYAGE_LLM_ENABLED === "0") return false;
  // Existing Voyage tests explicitly opt in when they exercise the LLM path.
  if (process.env.NODE_ENV === "test" && process.env.VOYAGE_LLM_ENABLED !== "1") return false;
  return true;
}

function llmMessages(input: { profile: PlanningProfile; messages: PlanningMessage[]; message?: string }) {
  const history = input.messages
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  const system = [
    "你是 Voyage 的旅行规划对话助手。",
    "从用户明确说出的内容中提取旅行规划偏好，不要猜测未提供的事实。",
    "只输出严格 JSON，不要 Markdown。格式：",
    '{"profilePatch":{},"assistantMessage":"简短回应","question":"至多一个高价值问题或 null","ready":false}',
    "profilePatch 只能使用 destination/origin/startDate/endDate/days/travelers/budget/pace/walkingTolerance/transportPreference/vibes/mustVisit/avoid/dietary/accessibility/children/elderly/budgetMode/socialOptIn。",
    "每轮最多提出一个问题；没有必要提问时 question 为 null。",
  ].join("\n");
  const profileContext = JSON.stringify(input.profile);
  return [
    { role: "system" as const, content: system },
    { role: "system" as const, content: `当前已确认的 profile：${profileContext}` },
    ...history,
    ...(input.message ? [{ role: "user" as const, content: input.message }] : []),
  ];
}

/** One bounded turn of conversational planning. */
export async function planConversationTurn(input: ConversationPlannerInput): Promise<ConversationPlannerResult> {
  const message = input.message?.trim();
  if (message && message.length > MAX_PLANNING_MESSAGE_CHARS) {
    throw new Error("Planning message exceeds the maximum length");
  }
  const history = input.messages ?? input.history ?? [];
  const base = canonicalPlanningProfile(input.profile ?? {});
  const rulePatch = message ? extractPlanningProfile(message) : {};
  const ruleProfile = mergePlanningProfiles(base, rulePatch);

  if (!llmEnabled()) {
    return buildRuleResult(ruleProfile, { llm: "skipped", fallbackReason: "当前运行环境未调用外部 LLM" });
  }
  if (!getLlmConfig()) {
    return buildRuleResult(ruleProfile, { llm: "unavailable", fallbackReason: "LLM_BASE_URL 未配置" });
  }

  try {
    const raw = await chatJson({
      messages: llmMessages({ profile: ruleProfile, messages: history, message }),
      maxTokens: 900,
    });
    const parsed = llmTurnSchema.safeParse(raw);
    if (!parsed.success) throw new Error("LLM conversation response failed schema validation");
    const modelPatch = parsed.data.profilePatch ?? parsed.data.profile ?? {};
    // Explicit facts in the current user turn win over a model paraphrase.
    const profile = mergePlanningProfiles(mergePlanningProfiles(base, modelPatch), rulePatch);
    const missing = missingPlanningFields(profile);
    const modelQuestion = validSingleQuestion(parsed.data.question ?? parsed.data.nextQuestion);
    if (modelQuestion === undefined) throw new Error("LLM returned more than one planning question");
    const question = missing.length ? modelQuestion ?? deterministicQuestion(profile, missing) : null;
    const assistantMessage = planningMessageSchema.parse({
      id: randomUUID(),
      role: "assistant",
      content: parsed.data.assistantMessage ?? parsed.data.reply,
      createdAt: new Date().toISOString(),
    });
    return {
      profile,
      assistantMessage,
      question,
      ready: missing.length === 0,
      missing,
      source: "llm",
      llm: "used",
    };
  } catch (error) {
    logger.warn("conversation-planner.llm_fallback_rules", { error });
    return buildRuleResult(ruleProfile, { llm: "failed", fallbackReason: safeErrorMessage(error) });
  }
}

/** Alias kept small and discoverable for callers that use `planConversation`. */
export const planConversation = planConversationTurn;

export class ConversationPlanner {
  async plan(input: ConversationPlannerInput) {
    return planConversationTurn(input);
  }

  async nextTurn(input: ConversationPlannerInput) {
    return planConversationTurn(input);
  }
}

export const planningSchemas = {
  pace: planningPaceSchema,
  walkingTolerance: planningWalkingToleranceSchema,
  transportPreference: planningTransportPreferenceSchema,
  budgetMode: planningBudgetModeSchema,
};
