import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chatWithTools, type ChatMessage, type LlmTool } from "@/services/ai/llm";
import { createRuntime } from "@/skill/runtime";
import { commandSchemas } from "@/skill/contracts";
import { guestWorkspace, setGuestCookie } from "@/app/api/voyage/workspace";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import { failureMessage, toolContextMessage } from "@/lib/failure-message";
import { weatherDisplay } from "@/lib/weather-display";
import type { Trip } from "@/types/travel";
import type { PlanningProfile } from "@/schemas/planning";
import { enforceRateLimit } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

const MAX_AGENT_HISTORY_MESSAGES = 12;
const MAX_AGENT_HISTORY_CHARS = 12_000;
const MAX_AGENT_HISTORY_MESSAGE_CHARS = 2_000;

const inputSchema = z.object({
  tripId: z.string().min(1),
  message: z.string().min(1).max(2000),
  /**
   * Bounded prior turns so follow-ups like "再少一点" resolve against what was
   * already said. Callers that only send tripId + message keep working.
   */
  history: z
    .array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(MAX_AGENT_HISTORY_MESSAGE_CHARS),
    }).strict())
    .max(MAX_AGENT_HISTORY_MESSAGES)
    .optional(),
});

/** Keep the most recent turns within both the count and total size bounds. */
function boundedHistory(history: z.output<typeof inputSchema>["history"]) {
  const kept: Array<{ role: "user" | "assistant"; content: string }> = [];
  let total = 0;
  for (const entry of [...(history ?? [])].reverse()) {
    if (kept.length >= MAX_AGENT_HISTORY_MESSAGES) break;
    if (total + entry.content.length > MAX_AGENT_HISTORY_CHARS) break;
    kept.push(entry);
    total += entry.content.length;
  }
  return kept.reverse();
}

const pointSchema = { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"], additionalProperties: false } as const;

const tools: LlmTool[] = [
  { type: "function", function: { name: "get_trip", description: "读取当前旅行的权威行程、地点（含坐标）和日期", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "search_places", description: "查询目的地真实地点、餐厅、酒店或活动 POI", parameters: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: ["attraction", "food", "cafe", "hotel", "activity", "shopping", "transport", "viewpoint"] }, limit: { type: "integer", minimum: 1, maximum: 12 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "get_place", description: "查询单个地点详情；可用行程内 placeId，或名称+城市从真实 POI 查询", parameters: { type: "object", properties: { placeId: { type: "string" }, name: { type: "string" }, city: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "plan_route", description: "在两个坐标之间规划单一路线（walk/metro/bus/taxi/drive）", parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, mode: { type: "string", enum: ["walk", "metro", "bus", "taxi", "drive"] }, city: { type: "string" } }, required: ["origin", "destination", "city"], additionalProperties: false } } },
  { type: "function", function: { name: "get_route_options", description: "返回多模式交通候选与结构化评分（步行、费用、换乘、天气等）", parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, city: { type: "string" }, walkingTolerance: { type: "string", enum: ["low", "medium", "high"] }, weather: { type: "string", enum: ["clear", "rain", "heat", "cold", "unknown"] } }, required: ["origin", "destination", "city"], additionalProperties: false } } },
  { type: "function", function: { name: "optimize_transport", description: "结合知识与上下文推荐最优市内交通方式，返回 rankedOptions 与解释", parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, city: { type: "string" }, walkingTolerance: { type: "string", enum: ["low", "medium", "high"] }, fatigue: { type: "string", enum: ["low", "medium", "high"] }, weather: { type: "string", enum: ["clear", "rain", "heat", "cold", "unknown"] } }, required: ["origin", "destination", "city"], additionalProperties: false } } },
  { type: "function", function: { name: "replan_trip", description: "针对某一天按自然语言指令重新规划交通与顺序；只生成提案，不直接修改行程", parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false } } },
  { type: "function", function: { name: "optimize_itinerary", description: "对整趟行程做一键智能重排（按地理位置聚类、时间窗与偏好优化），适合「优化安排」「少走回头路」类请求；只生成提案，不直接修改行程", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_weather", description: "查询当前行程目的地的天气预报", parameters: { type: "object", properties: { dates: { type: "array", items: { type: "string", format: "date" }, maxItems: 7 } }, required: ["dates"], additionalProperties: false } } },
  { type: "function", function: { name: "retrieve_travel_knowledge", description: "检索城市旅行知识（地形、交通规律、经验）；仅作为背景，不替代实时数据", parameters: { type: "object", properties: { city: { type: "string" }, query: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["city", "query"], additionalProperties: false } } },
  { type: "function", function: { name: "search_social_travel", description: "搜索社交平台实时旅行内容并返回可验证 evidence（platform/sourceUrl/publishedAt/metrics/confidence）", parameters: { type: "object", properties: { city: { type: "string" }, query: { type: "string" }, poi: { type: "string" } }, required: ["city"], additionalProperties: false } } },
  { type: "function", function: { name: "find_trending_places", description: "发现近期社媒热度最高的旅行地点信号", parameters: { type: "object", properties: { city: { type: "string" }, platform: { type: "string" } }, required: ["city"], additionalProperties: false } } },
  { type: "function", function: { name: "get_social_evidence", description: "聚合某地/某 POI 的多平台社交证据与 crowd/trend 上下文", parameters: { type: "object", properties: { city: { type: "string" }, poi: { type: "string" }, query: { type: "string" } }, required: ["city"], additionalProperties: false } } },
  { type: "function", function: { name: "search_travel_offers", description: "查询酒店、火车、机票、门票、美食或优惠；返回供应商提供的可验证结果", parameters: { type: "object", properties: { query: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["hotel", "train", "flight", "ticket", "restaurant", "coupon"] } } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "propose_change", description: "根据用户指令生成行程修改提案；只生成 Diff，不直接修改行程", parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false } } },
  { type: "function", function: { name: "apply_change", description: "应用一个已生成的提案；必须由用户在 Diff 确认界面确认后由系统调用，LLM 不得自行调用", parameters: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"], additionalProperties: false } } },
  { type: "function", function: { name: "get_trip_state", description: "读取行程当前执行状态：阶段、当前/下一站、晚点分钟数、剩余步行、预计结束时间、进行中的预订与事件、风险等级", parameters: { type: "object", properties: { asOf: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "get_reservations", description: "查询行程的预订列表（航班/高铁/酒店/餐厅/门票等）及其状态", parameters: { type: "object", properties: { status: { type: "string", enum: ["tentative", "confirmed", "cancelled", "completed"] }, type: { type: "string", enum: ["flight", "train", "hotel", "restaurant", "attraction", "activity", "car", "transfer", "other"] } }, additionalProperties: false } } },
  { type: "function", function: { name: "get_active_events", description: "读取当前生效的旅行事件（天气变化、航班延误、景点关闭、用户晚点等）", parameters: { type: "object", properties: { asOf: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "get_constraints", description: "读取约束引擎视图：已确认预订产生的硬约束、违规项与评分", parameters: { type: "object", properties: { dayId: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "analyze_event_impact", description: "分析一个事件对行程的影响：受影响/有风险/无法完成的安排、时间与预算影响、可选策略（只读，不修改）", parameters: { type: "object", properties: { eventId: { type: "string" }, event: { type: "object", properties: { type: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "critical"] }, effectiveFrom: { type: "string" }, effectiveUntil: { type: "string" }, summary: { type: "string" }, payload: { type: "object" } } }, asOf: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "propose_event_replan", description: "事件驱动的重规划：基于事件影响生成整体重排提案（Diff），必须由用户确认后应用；已确认预订的安排会被自动保护", parameters: { type: "object", properties: { eventId: { type: "string" }, event: { type: "object", properties: { type: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "critical"] }, effectiveFrom: { type: "string" }, effectiveUntil: { type: "string" }, summary: { type: "string" }, payload: { type: "object" } } }, asOf: { type: "string" }, strategy: { type: "string", enum: ["auto", "shift", "skip", "indoorSwap", "replace", "release", "reduceWalking", "reduceBudget", "swapMode", "monitor"] } }, additionalProperties: false } } },
];

const allowedToolNames: Record<string, true> = Object.fromEntries(tools.map((tool) => [tool.function.name, true as const]));

/** What the UI shows per tool call: name + a human-readable arg/result digest. */
export interface AgentToolCallTrace {
  name: string;
  argsSummary: string;
  resultSummary: string;
  ok: boolean;
}

const RESULT_LABELS: Record<string, string> = {
  places: "地点",
  offers: "报价",
  forecast: "天气预报",
  evidence: "社交证据",
  matches: "知识条目",
  routeOptions: "交通候选",
  route: "路线",
};

function summarizeArgs(args: Record<string, unknown>) {
  return Object.entries(args ?? {})
    .filter(([, value]) => value !== undefined && value !== "" && value !== null)
    .slice(0, 2)
    .map(([key, value]) => `${key}=${typeof value === "object" ? "…" : String(value).slice(0, 40)}`)
    .join(", ");
}

function summarizeResult(name: string, result: unknown) {
  if (name === "apply_change") return "已拒绝：提案必须由用户确认";
  const data = (result as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return "完成";
  if (typeof data.proposalId === "string") return "提案已生成，等待用户在 Diff 确认";
  for (const [key, label] of Object.entries(RESULT_LABELS)) {
    const value = data[key];
    if (Array.isArray(value)) return `${label}：${value.length} 条`;
    if (value && typeof value === "object") return `${label}：已完成`;
  }
  if (typeof data.summary === "string" && data.summary.trim()) return data.summary.slice(0, 80);
  return "完成";
}

function safeToolResult(name: string, value: unknown) {
  const data = value as { data?: Record<string, unknown>; providerStatus?: unknown; warnings?: unknown };
  if (name === "get_trip") {
    const trip = data.data?.trip as TripSummary | undefined;
    const tasksPending = trip?.tasks?.filter((task) => task.status !== "done").length ?? 0;
    return JSON.stringify({
      destination: trip?.destination,
      origin: trip?.origin,
      dates: trip?.days?.map((day) => ({ id: day.id, date: day.date, title: day.title, weather: day.weather?.condition ?? "未知" })),
      places: trip?.places?.slice(0, 20).map((place) => ({ name: place.name, category: place.category, lat: place.lat, lng: place.lng, id: place.id })),
      tasksPending,
      tasksTotal: trip?.tasks?.length ?? 0,
      offersCount: trip?.offers?.length ?? 0,
    });
  }
  if (name === "search_places" || name === "get_place") {
    const places = (data.data?.places ?? (data.data?.place ? [data.data.place] : [])) as Array<Record<string, unknown>>;
    return JSON.stringify({ places: places.slice(0, 12).map((place) => ({ id: place.id, name: place.name, address: place.address, category: place.category, lat: place.lat, lng: place.lng, source: place.source, rating: place.rating, priceLabel: place.priceLabel })), providerStatus: data.providerStatus, warnings: data.warnings });
  }
  if (name === "search_travel_offers") {
    const offers = data.data?.offers as Array<Record<string, unknown>> | undefined;
    return JSON.stringify({ offers: offers?.slice(0, 12).map((offer) => ({ kind: offer.kind, title: offer.title, priceLabel: offer.priceLabel, availability: offer.availability, bookingUrl: offer.bookingUrl, provider: offer.provider, fetchedAt: offer.fetchedAt, structured: offer.structured })), providerStatus: data.providerStatus, warnings: data.warnings });
  }
  if (name === "get_route_options" || name === "optimize_transport") {
    const routeOptions = (data.data?.routeOptions ?? {}) as { recommendedMode?: string; options?: Array<Record<string, unknown>>; warnings?: string[] };
    return JSON.stringify({ recommendedMode: routeOptions.recommendedMode, options: routeOptions.options?.slice(0, 5).map((option) => ({ mode: option.mode, score: option.score, durationMinutes: option.durationMinutes, cost: option.cost, walkingMeters: option.walkingMeters, transferCount: option.transferCount, estimated: option.estimated, confidence: option.confidence })), knowledgeCitations: data.data?.knowledgeCitations, providerStatus: data.providerStatus, warnings: data.warnings });
  }
  if (name === "search_social_travel" || name === "find_trending_places" || name === "get_social_evidence") {
    const evidence = data.data?.evidence as Array<Record<string, unknown>> | undefined;
    const context = data.data?.context as Record<string, unknown> | undefined;
    return JSON.stringify({ evidence: evidence?.slice(0, 8).map((item) => ({ platform: item.platform, sourceId: item.sourceId, sourceUrl: item.sourceUrl, summary: item.summary, publishedAt: item.publishedAt, fetchedAt: item.fetchedAt, confidence: item.confidence, metrics: item.metrics, poiMatches: item.poiMatches })), crowdRisk: context?.crowdRisk, recentTrend: context?.recentTrend, providerStatus: data.providerStatus, warnings: data.warnings });
  }
  if (name === "retrieve_travel_knowledge") {
    const matches = data.data?.matches as Array<Record<string, unknown>> | undefined;
    return JSON.stringify({ matches: matches?.slice(0, 6).map((match) => ({ title: match.title, content: typeof match.content === "string" ? match.content.slice(0, 400) : match.content, tags: match.tags, confidence: match.confidence, authorityLevel: match.authorityLevel, source: match.source })), retrieval: data.data?.retrieval, warnings: data.warnings });
  }
  if (name === "plan_route") {
    const route = data.data?.route as Record<string, unknown> | undefined;
    return JSON.stringify({ mode: route?.mode, distanceMeters: route?.distanceMeters, durationMinutes: route?.durationMinutes, estimated: route?.estimated, provider: route?.source, warnings: data.warnings });
  }
  if (name === "replan_trip" || name === "propose_change" || name === "optimize_itinerary" || name === "propose_event_replan") {
    const proposal = data.data as Record<string, unknown> | undefined;
    return JSON.stringify({ proposalId: proposal?.proposalId, baseRevision: proposal?.baseRevision, summary: proposal?.summary, strategy: proposal?.strategy, note: "提案已生成，必须由用户在 Diff 界面确认后才能应用" });
  }
  if (name === "get_trip_state") {
    const state = data.data?.state as Record<string, unknown> | undefined;
    return JSON.stringify({
      phase: state?.phase,
      currentDay: state?.currentDay,
      lateByMinutes: state?.lateByMinutes,
      riskLevel: state?.riskLevel,
      estimatedFinishTime: state?.estimatedFinishTime,
      activeEvents: state?.activeEvents,
      upcomingHardConstraints: state?.upcomingHardConstraints,
      suggestedActions: state?.suggestedActions,
    });
  }
  if (name === "get_reservations") {
    const reservations = data.data?.reservations as Array<Record<string, unknown>> | undefined;
    return JSON.stringify({ reservations: reservations?.slice(0, 10).map((item) => ({ id: item.id, type: item.type, title: item.title, status: item.status, startAt: item.startAt, endAt: item.endAt ?? null, confirmationCode: item.confirmationCode ?? null })), total: data.data?.total });
  }
  if (name === "get_active_events") {
    const events = data.data?.events as Array<Record<string, unknown>> | undefined;
    return JSON.stringify({ events: events?.slice(0, 10).map((item) => ({ id: item.id, type: item.type, severity: item.severity, summary: item.summary ?? null })), total: data.data?.total });
  }
  if (name === "get_constraints") {
    return JSON.stringify({
      score: data.data?.score,
      hardViolations: data.data?.hardViolations,
      softPenaltyCount: Array.isArray(data.data?.softPenalties) ? (data.data?.softPenalties as unknown[]).length : 0,
      unresolvedConstraints: data.data?.unresolvedConstraints,
    });
  }
  if (name === "analyze-event-impact" || name === "analyze_event_impact") {
    const impact = data.data?.impact as Record<string, unknown> | undefined;
    return JSON.stringify({
      eventType: impact?.eventType,
      severity: impact?.severity,
      summary: impact?.summary,
      atRisk: impact?.atRiskItemIds,
      impossible: impact?.impossibleItemIds,
      recommendedStrategy: impact?.recommendedStrategy,
      options: impact?.options,
      unknowns: impact?.unknowns,
    });
  }
  return JSON.stringify(value, (_key, item) => typeof item === "string" && item.length > 600 ? `${item.slice(0, 600)}…` : item);
}

type TripSummary = {
  destination?: string;
  origin?: string;
  days?: Array<{ id: string; date: string; title?: string; weather?: { condition?: string } }>;
  places?: Array<{ name: string; category: string; lat?: number; lng?: number; id?: string }>;
  tasks?: Array<{ status?: string }>;
  offers?: unknown[];
};

const PACE_LABEL: Record<NonNullable<PlanningProfile["pace"]>, string> = {
  relaxed: "轻松慢节奏",
  balanced: "适中节奏",
  packed: "紧凑多安排",
};
const WALKING_LABEL: Record<NonNullable<PlanningProfile["walkingTolerance"]>, string> = {
  low: "少走路",
  medium: "步行适中",
  high: "可以多走",
};
const TRANSPORT_LABEL: Record<NonNullable<PlanningProfile["transportPreference"]>, string> = {
  mixed: "混合交通",
  public: "公共交通优先",
  metro: "地铁优先",
  bus: "公交优先",
  taxi: "打车优先",
  drive: "自驾",
  walk: "以步行为主",
};
const BUDGET_MODE_LABEL: Record<NonNullable<PlanningProfile["budgetMode"]>, string> = {
  tight: "省钱优先",
  balanced: "性价比优先",
  flexible: "预算宽松",
};

function labeledText(value: PlanningProfile["accessibility"]) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value ? "有无障碍需求" : undefined;
  return value.length ? value.join("、") : undefined;
}

function companionText(value: PlanningProfile["children"]) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value ? "同行" : undefined;
  return value > 0 ? `同行 ${value} 人` : undefined;
}

/**
 * Confirmed preferences come from the trip's own metadata, so the post-generation
 * agent honours what the traveller already agreed to without re-reading the
 * planning session.
 */
function confirmedPreferenceLine(profile?: PlanningProfile) {
  if (!profile) return "";
  const parts = [
    profile.pace ? `节奏=${PACE_LABEL[profile.pace]}` : "",
    profile.walkingTolerance ? `步行=${WALKING_LABEL[profile.walkingTolerance]}` : "",
    profile.transportPreference ? `交通=${TRANSPORT_LABEL[profile.transportPreference]}` : "",
    profile.budgetMode ? `预算倾向=${BUDGET_MODE_LABEL[profile.budgetMode]}` : "",
    profile.vibes.length ? `氛围=${profile.vibes.join("、")}` : "",
    profile.mustVisit.length ? `必去=${profile.mustVisit.join("、")}` : "",
    profile.avoid.length ? `避开=${profile.avoid.join("、")}` : "",
    profile.dietary.length ? `饮食=${profile.dietary.join("、")}` : "",
    labeledText(profile.accessibility) ? `无障碍=${labeledText(profile.accessibility)}` : "",
    companionText(profile.children) ? `儿童=${companionText(profile.children)}` : "",
    companionText(profile.elderly) ? `老人=${companionText(profile.elderly)}` : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return [
    `用户在规划对话中已确认的偏好：${parts.join("，")}。`,
    "这些是用户明确确认的约束，必须优先遵守；若用户的请求与之冲突，先说明冲突再给替代方案，不要静默违背，也不要谎称已经满足。",
  ].join("");
}

/** Budget and walking facts the agent needs to answer "预算超了吗"/"走太多路了" honestly. */
function tripStateLine(trip: Trip) {
  const segments = trip.segments ?? [];
  const plannedKm = segments.reduce((total, segment) => total + (segment.distanceMeters ?? segment.meters ?? 0), 0) / 1000;
  const walkingKm = segments
    .filter((segment) => segment.mode === "walk")
    .reduce((total, segment) => total + (segment.distanceMeters ?? segment.meters ?? 0), 0) / 1000;
  const estimatedSegments = segments.filter((segment) => segment.estimated).length;
  const remaining = trip.budget - trip.estimatedSpend;
  const parts = [
    plannedKm > 0
      ? `已规划路线合计约 ${plannedKm.toFixed(1)} 公里，其中步行约 ${walkingKm.toFixed(1)} 公里（${estimatedSegments}/${segments.length} 段为估算值，不是实测）`
      : "",
    `预算 ${trip.budget} 元，预估花费 ${trip.estimatedSpend} 元（预估值，不是实际支出），剩余约 ${Math.round(remaining)} 元`,
  ].filter(Boolean);
  return parts.length ? `当前行程状态：${parts.join("；")}。` : "";
}

/** Per-day weather the agent can cite without calling get_weather again. */
function weatherLine(trip: Trip) {
  const known = (trip.days ?? [])
    .filter((day) => weatherDisplay(day.weather).known)
    .slice(0, 7)
    .map((day) => `${day.date} ${day.weather!.condition}`);
  return known.length ? `已知天气预报：${known.join("，")}。` : "";
}

/** Where the traveller is relative to the trip dates, so "今天" is unambiguous. */
function phaseLine(trip: Trip, todayIso: string) {
  const dayIndex = trip.days?.findIndex((day) => day.date === todayIso) ?? -1;
  if (dayIndex >= 0) return `今天是 ${todayIso}，行程第 ${dayIndex + 1} 天（共 ${trip.days?.length ?? 0} 天）。`;
  if (trip.startDate && todayIso < trip.startDate) return `今天是 ${todayIso}，行程尚未出发（${trip.startDate} 开始）。`;
  if (trip.endDate && todayIso > trip.endDate) return `今天是 ${todayIso}，行程已结束。`;
  return `今天是 ${todayIso}。`;
}

function transportContextFromArgs(args: Record<string, unknown>) {
  const context: Record<string, unknown> = {};
  if (typeof args.walkingTolerance === "string") context.walkingTolerance = args.walkingTolerance;
  if (typeof args.fatigue === "string") context.fatigue = args.fatigue;
  if (typeof args.weather === "string") context.weather = args.weather;
  return Object.keys(context).length ? context : undefined;
}

export async function POST(request: NextRequest) {
  // Paid providers behind this route share one budget per caller.
  const limited = enforceRateLimit(request, "llm");
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  const workspace = guestWorkspace(request);
  if (process.env.VOYAGE_DEMO_MODE === "true" && parsed.data.tripId === DEMO_TRIP_ID) {
    const repository = new JsonSkillRepository(workspace.root);
    if (!(await repository.getTrip(DEMO_TRIP_ID))) {
      await repository.createTrip(structuredClone(chongqingTrip));
    }
  }
  const runtime = createRuntime(workspace.root);
  const tripEnvelope = await runtime.execute("get-trip", { tripId: parsed.data.tripId }) as { data?: { trip?: { destination?: string; origin?: string; startDate?: string; endDate?: string; travelers?: number; budget?: number; days?: Array<{ id: string; date: string }> }; revision?: number } };
  const trip = tripEnvelope.data?.trip;
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found" }, { status: 404 });

  if (process.env.VOYAGE_DEMO_MODE === "true" &&
    /少走|走路|太累|下雨|雨方案|推迟|跳过|省100|换个地方/.test(parsed.data.message)) {
    try {
      const dayId = parsed.data.message.match(/\[dayId:([^\]]+)\]/)?.[1];
      const proposal = await runtime.execute("propose-change", commandSchemas["propose-change"].parse({
        tripId: parsed.data.tripId, instruction: parsed.data.message, dayId, fallbackPolicy: "estimated",
      }));
      return setGuestCookie(NextResponse.json({
        ok: true,
        content: "已生成行程修改建议",
        toolsUsed: ["propose_change"],
        toolCalls: [{ name: "propose_change", argsSummary: "规则规划", resultSummary: "提案已生成，等待用户在 Diff 确认", ok: true }],
        proposal,
      }), workspace);
    } catch (error) {
      return setGuestCookie(NextResponse.json({ ok: false, error: failureMessage(error, "无法生成提案") }, { status: 422 }), workspace);
    }
  }
  const fullTrip = (tripEnvelope.data as { trip?: Trip } | undefined)?.trip;
  const todayIso = new Date().toISOString().slice(0, 10);
  const systemPrompt = [
    "你是 Voyage 旅行助手。用中文回答。",
    "核心规则：不要编造价格、库存、天气或地点；回答事实性问题前先用工具取真实数据。",
    "行程修改只能生成提案，必须让用户在 Diff 界面确认后才能应用；禁止自行调用 apply_change，用户问「能不能改」时用 propose_change 生成提案。",
    "工具使用要点：get_trip 先看行程全貌；get_weather 查天气；search_places 找或换地点；get_route_options / optimize_transport 做市内交通对比；search_travel_offers 查酒店、车票、门票报价；search_social_travel / get_social_evidence 看社交平台的实地反馈；propose_change 生成通用修改提案，replan_trip 专攻某一天的交通方式与顺序，optimize_itinerary 一键重排整趟行程（用户说「优化安排 / 少走回头路 / 重新排一下」时用）。",
    "用户消息中的 [dayId:xxx] 前缀表示用户当前聚焦的行程日，涉及「今天/这天」的操作优先用它。",
    "现实变化场景（延误、下雨、景点关闭、晚点等）的决策序：先 get_trip_state 了解现状，再 get_active_events 看事件，然后 analyze_event_impact 评估影响，最后 propose_event_replan 生成方案提案；涉及预订（航班/高铁/酒店/餐厅/门票）的安排是硬约束，任何方案都必须保留其时间。",
    "主动牵引：回答末尾用一句话主动建议一个合理的下一步（信息不足就直接反问用户）；不要罗列工具名，不要复述用户已知的内容。",
    `当前行程：${trip.origin ?? ""} → ${trip.destination ?? ""}，${trip.startDate ?? ""} 至 ${trip.endDate ?? ""}，${trip.travelers ?? 1} 人，总预算 ${trip.budget ?? 0} 元。`,
    fullTrip ? phaseLine(fullTrip, todayIso) : "",
    fullTrip ? weatherLine(fullTrip) : "",
    confirmedPreferenceLine(fullTrip?.planningMetadata?.planningProfile),
    fullTrip ? tripStateLine(fullTrip) : "",
  ].filter(Boolean).join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...boundedHistory(parsed.data.history),
    { role: "user", content: parsed.data.message },
  ];
  let proposal: unknown;
  let lastContent = "";
  const toolTrace: string[] = [];
  const toolCalls: AgentToolCallTrace[] = [];
  try {
    for (let round = 0; round < 3; round += 1) {
      const answer = await chatWithTools({ messages, tools });
      if (answer.content) lastContent = answer.content;
      if (!answer.toolCalls.length) return setGuestCookie(NextResponse.json({ ok: true, content: answer.content, toolsUsed: toolTrace, toolCalls, proposal }), workspace);
      messages.push({ role: "assistant", content: answer.content || null, tool_calls: answer.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
      for (const call of answer.toolCalls) {
        const argsSummary = summarizeArgs(call.arguments as Record<string, unknown>);
        if (!(call.name in allowedToolNames)) {
          toolCalls.push({ name: call.name, argsSummary, resultSummary: "工具不在白名单，已跳过", ok: false });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Tool is not allowed" }) });
          continue;
        }
        toolTrace.push(call.name);
        const args = call.arguments as Record<string, unknown>;
        let result: unknown;
        try {
          switch (call.name) {
            case "get_trip":
              result = tripEnvelope;
              break;
            case "search_places":
              result = await runtime.execute("search-places", commandSchemas["search-places"].parse({ destination: trip.destination, query: args.query, category: args.category, limit: args.limit ?? 8 }));
              break;
            case "get_place":
              result = await runtime.execute("get-place", commandSchemas["get-place"].parse(args.placeId ? { placeId: args.placeId, tripId: parsed.data.tripId } : { name: args.name, city: args.city ?? trip.destination }));
              break;
            case "plan_route":
              result = await runtime.execute("plan-route", commandSchemas["plan-route"].parse({ origin: args.origin, destination: args.destination, mode: args.mode ?? "walk", city: args.city ?? trip.destination, fallbackPolicy: "estimated" }));
              break;
            case "get_route_options":
              result = await runtime.execute("get-route-options", commandSchemas["get-route-options"].parse({ origin: args.origin, destination: args.destination, city: args.city ?? trip.destination, context: transportContextFromArgs(args), fallbackPolicy: "estimated" }));
              break;
            case "optimize_transport":
              result = await runtime.execute("optimize-transport", commandSchemas["optimize-transport"].parse({ origin: args.origin, destination: args.destination, city: args.city ?? trip.destination, context: transportContextFromArgs(args), fallbackPolicy: "estimated" }));
              break;
            case "replan_trip":
              result = await runtime.execute("replan-trip", commandSchemas["replan-trip"].parse({ tripId: parsed.data.tripId, instruction: args.instruction, dayId: args.dayId, fallbackPolicy: "estimated" }));
              proposal = result;
              break;
            case "optimize_itinerary":
              result = await runtime.execute("optimize-itinerary", commandSchemas["optimize-itinerary"].parse({
                tripId: parsed.data.tripId,
                expectedTripRevision: tripEnvelope.data?.revision,
                fallbackPolicy: "estimated",
              }));
              proposal = result;
              break;
            case "get_weather":
              result = await runtime.execute("get-weather", commandSchemas["get-weather"].parse({ destination: trip.destination, dates: args.dates, fallbackPolicy: "deny" }));
              break;
            case "retrieve_travel_knowledge":
              result = await runtime.execute("retrieve-travel-knowledge", commandSchemas["retrieve-travel-knowledge"].parse({ city: args.city ?? trip.destination, query: args.query, tags: args.tags ?? [] }));
              break;
            case "search_social_travel":
              result = await runtime.execute("search-social", commandSchemas["search-social"].parse({ city: args.city ?? trip.destination, query: args.query, poi: args.poi }));
              break;
            case "find_trending_places":
              result = await runtime.execute("get-social-trending", commandSchemas["get-social-trending"].parse({ city: args.city ?? trip.destination, platform: args.platform }));
              break;
            case "get_social_evidence":
              result = await runtime.execute("get-social-evidence", commandSchemas["get-social-evidence"].parse({ city: args.city ?? trip.destination, poi: args.poi, query: args.query, tripId: parsed.data.tripId }));
              break;
            case "search_travel_offers":
              result = await runtime.execute("search-travel-offers", commandSchemas["search-travel-offers"].parse({ origin: trip.origin, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, budget: trip.budget, query: args.query, categories: args.categories ?? ["train", "hotel", "restaurant"] }));
              break;
            case "propose_change":
              result = await runtime.execute("propose-change", commandSchemas["propose-change"].parse({ tripId: parsed.data.tripId, instruction: args.instruction, dayId: args.dayId, fallbackPolicy: "estimated" }));
              proposal = result;
              break;
            case "apply_change":
              // Confirmation discipline: the LLM may never apply a change. It
              // can only point the user to the Diff confirmation UI.
              result = { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "apply_change 必须由用户在 Diff 确认界面确认后由系统调用；请使用 propose_change 生成提案" } };
              break;
            case "get_trip_state":
              result = await runtime.execute("get-trip-state", commandSchemas["get-trip-state"].parse({ tripId: parsed.data.tripId, ...(args.asOf ? { asOf: args.asOf } : {}) }));
              break;
            case "get_reservations":
              result = await runtime.execute("get-reservations", commandSchemas["get-reservations"].parse({ tripId: parsed.data.tripId, ...(args.status ? { status: args.status } : {}), ...(args.type ? { type: args.type } : {}) }));
              break;
            case "get_active_events":
              result = await runtime.execute("get-active-events", commandSchemas["get-active-events"].parse({ tripId: parsed.data.tripId, includeAcknowledged: true, ...(args.asOf ? { asOf: args.asOf } : {}) }));
              break;
            case "get_constraints":
              result = await runtime.execute("get-constraints", commandSchemas["get-constraints"].parse({ tripId: parsed.data.tripId, ...(args.dayId ? { dayId: args.dayId } : {}) }));
              break;
            case "analyze_event_impact":
              result = await runtime.execute("analyze-event-impact", commandSchemas["analyze-event-impact"].parse({
                tripId: parsed.data.tripId,
                ...(args.eventId ? { eventId: args.eventId } : {}),
                ...(args.event ? { event: args.event } : {}),
                ...(args.asOf ? { asOf: args.asOf } : {}),
              }));
              break;
            case "propose_event_replan":
              result = await runtime.execute("propose-event-replan", commandSchemas["propose-event-replan"].parse({
                tripId: parsed.data.tripId,
                ...(args.eventId ? { eventId: args.eventId } : {}),
                ...(args.event ? { event: args.event } : {}),
                ...(args.asOf ? { asOf: args.asOf } : {}),
                ...(args.strategy ? { strategy: args.strategy } : {}),
                fallbackPolicy: "estimated",
              }));
              proposal = result;
              break;
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: safeToolResult(call.name, result) });
          toolCalls.push({ name: call.name, argsSummary, resultSummary: summarizeResult(call.name, result), ok: true });
        } catch (error) {
          // A raw Zod dump in tool context gets echoed back to the user by the model.
          const reason = toolContextMessage(error);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: reason }) });
          toolCalls.push({ name: call.name, argsSummary, resultSummary: reason, ok: false });
        }
      }
    }
    // Loop exhausted: return the data already gathered instead of a bare 422
    // that throws away every tool result the user is waiting for.
    return setGuestCookie(NextResponse.json({
      ok: true,
      content: lastContent || "已完成工具查询，但未能生成最终总结；请换个问法或稍后重试。",
      toolsUsed: toolTrace,
      toolCalls,
      proposal,
      warnings: ["工具调用轮次达到上限，以上为已获取的部分结果"],
    }), workspace);
  } catch (error) {
    return setGuestCookie(NextResponse.json({ ok: false, error: failureMessage(error, "工具调用失败，请稍后重试"), toolsUsed: toolTrace, toolCalls }, { status: 502 }), workspace);
  }
}
