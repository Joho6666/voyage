import { commandSchemas } from "@/skill/contracts";
import type { VoyageSkillRuntime } from "@/skill/runtime";

/**
 * Single source of truth for the Web Agent tool surface: each entry owns its
 * LLM schema, its execution, and its result serialization. Previously these
 * lived in three parallel structures (a schema array, an executor switch and a
 * serializer if-chain), so every new tool needed three synchronized edits —
 * the `analyze_event_impact` double-branch happened exactly that way.
 *
 * The LLM-visible descriptions are byte-pinned by tests/golden/prompts —
 * edit them deliberately and refresh the snapshots.
 */

export interface AgentToolContext {
  /** Current trip facts used to fill command inputs (destination, budget…). */
  trip: {
    /** Optional fields stay optional: the original loop passed envelope
     * values verbatim into zod parse, which owns the required-field errors. */
    destination?: string;
    origin?: string;
    startDate?: string;
    endDate?: string;
    travelers?: number;
    budget?: number;
  };
  tripId: string;
  tripRevision?: number;
  runtime: VoyageSkillRuntime;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<unknown>;
  /** Shrinks a tool result to the tokens the model actually needs. */
  serialize: (value: unknown) => string;
  /** Optional UI trace override; the shared summary runs otherwise. */
  summary?: (result: unknown) => string;
  /** Proposal-returning tools feed the Diff confirmation UI. */
  isProposal?: boolean;
}

const pointSchema = { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"], additionalProperties: false } as const;

const RESULT_LABELS: Record<string, string> = {
  places: "地点",
  offers: "报价",
  forecast: "天气预报",
  evidence: "社交证据",
  matches: "知识条目",
  routeOptions: "交通候选",
  route: "路线",
};

/** Shared trace summary: label + count for envelope arrays, else a digest. */
export function summarizeResult(result: unknown) {
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

/** Default serializer: everything, with long strings capped. */
function defaultSerialize(value: unknown) {
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

interface Envelope {
  data?: Record<string, unknown>;
  providerStatus?: unknown;
  warnings?: unknown;
}

const proposalNote = "提案已生成，必须由用户在 Diff 界面确认后才能应用";

export const agentTools: AgentTool[] = [
  {
    name: "get_trip",
    description: "读取当前旅行的权威行程、地点（含坐标）和日期",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    isProposal: false,
    // Live read, not the pre-loop envelope: a proposal applied in an earlier
    // round bumps the revision, and a cached snapshot would describe a trip
    // that no longer exists.
    async execute(_args, ctx) {
      return ctx.runtime.execute("get-trip", { tripId: ctx.tripId });
    },
    serialize(value) {
      const data = value as Envelope;
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
    },
  },
  {
    name: "search_places",
    description: "查询目的地真实地点、餐厅、酒店或活动 POI",
    parameters: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: ["attraction", "food", "cafe", "hotel", "activity", "shopping", "transport", "viewpoint"] }, limit: { type: "integer", minimum: 1, maximum: 12 } }, required: ["query"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("search-places", commandSchemas["search-places"].parse({ destination: ctx.trip.destination, query: args.query, category: args.category, limit: args.limit ?? 8 }));
    },
    serialize(value) {
      const data = value as Envelope;
      const places = (data.data?.places ?? (data.data?.place ? [data.data.place] : [])) as Array<Record<string, unknown>>;
      return JSON.stringify({ places: places.slice(0, 12).map((place) => ({ id: place.id, name: place.name, address: place.address, category: place.category, lat: place.lat, lng: place.lng, source: place.source, rating: place.rating, priceLabel: place.priceLabel })), providerStatus: data.providerStatus, warnings: data.warnings });
    },
  },
  {
    name: "get_place",
    description: "查询单个地点详情；可用行程内 placeId，或名称+城市从真实 POI 查询",
    parameters: { type: "object", properties: { placeId: { type: "string" }, name: { type: "string" }, city: { type: "string" } }, additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-place", commandSchemas["get-place"].parse(args.placeId ? { placeId: args.placeId, tripId: ctx.tripId } : { name: args.name, city: args.city ?? ctx.trip.destination }));
    },
    serialize(value) {
      const data = value as Envelope;
      const places = (data.data?.places ?? (data.data?.place ? [data.data.place] : [])) as Array<Record<string, unknown>>;
      return JSON.stringify({ places: places.slice(0, 12).map((place) => ({ id: place.id, name: place.name, address: place.address, category: place.category, lat: place.lat, lng: place.lng, source: place.source, rating: place.rating, priceLabel: place.priceLabel })), providerStatus: data.providerStatus, warnings: data.warnings });
    },
  },
  {
    name: "plan_route",
    description: "在两个坐标之间规划单一路线（walk/metro/bus/taxi/drive）",
    parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, mode: { type: "string", enum: ["walk", "metro", "bus", "taxi", "drive"] }, city: { type: "string" } }, required: ["origin", "destination", "city"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("plan-route", commandSchemas["plan-route"].parse({ origin: args.origin, destination: args.destination, mode: args.mode ?? "walk", city: args.city ?? ctx.trip.destination, fallbackPolicy: "estimated" }));
    },
    serialize(value) {
      const data = value as Envelope;
      const route = data.data?.route as Record<string, unknown> | undefined;
      return JSON.stringify({ mode: route?.mode, distanceMeters: route?.distanceMeters, durationMinutes: route?.durationMinutes, estimated: route?.estimated, provider: route?.source, warnings: data.warnings });
    },
  },
  {
    name: "get_route_options",
    description: "返回多模式交通候选与结构化评分（步行、费用、换乘、天气等）",
    parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, city: { type: "string" }, walkingTolerance: { type: "string", enum: ["low", "medium", "high"] }, weather: { type: "string", enum: ["clear", "rain", "heat", "cold", "unknown"] } }, required: ["origin", "destination", "city"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-route-options", commandSchemas["get-route-options"].parse({ origin: args.origin, destination: args.destination, city: args.city ?? ctx.trip.destination, context: transportContextFromArgs(args), fallbackPolicy: "estimated" }));
    },
    serialize(value) {
      const data = value as Envelope;
      const routeOptions = (data.data?.routeOptions ?? {}) as { recommendedMode?: string; options?: Array<Record<string, unknown>>; warnings?: string[] };
      return JSON.stringify({ recommendedMode: routeOptions.recommendedMode, options: routeOptions.options?.slice(0, 5).map((option) => ({ mode: option.mode, score: option.score, durationMinutes: option.durationMinutes, cost: option.cost, walkingMeters: option.walkingMeters, transferCount: option.transferCount, estimated: option.estimated, confidence: option.confidence })), knowledgeCitations: data.data?.knowledgeCitations, providerStatus: data.providerStatus, warnings: data.warnings });
    },
  },
  {
    name: "optimize_transport",
    description: "结合知识与上下文推荐最优市内交通方式，返回 rankedOptions 与解释",
    parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, city: { type: "string" }, walkingTolerance: { type: "string", enum: ["low", "medium", "high"] }, fatigue: { type: "string", enum: ["low", "medium", "high"] }, weather: { type: "string", enum: ["clear", "rain", "heat", "cold", "unknown"] } }, required: ["origin", "destination", "city"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("optimize-transport", commandSchemas["optimize-transport"].parse({ origin: args.origin, destination: args.destination, city: args.city ?? ctx.trip.destination, context: transportContextFromArgs(args), fallbackPolicy: "estimated" }));
    },
    serialize(value) {
      const data = value as Envelope;
      const routeOptions = (data.data?.routeOptions ?? {}) as { recommendedMode?: string; options?: Array<Record<string, unknown>>; warnings?: string[] };
      return JSON.stringify({ recommendedMode: routeOptions.recommendedMode, options: routeOptions.options?.slice(0, 5).map((option) => ({ mode: option.mode, score: option.score, durationMinutes: option.durationMinutes, cost: option.cost, walkingMeters: option.walkingMeters, transferCount: option.transferCount, estimated: option.estimated, confidence: option.confidence })), knowledgeCitations: data.data?.knowledgeCitations, providerStatus: data.providerStatus, warnings: data.warnings });
    },
  },
  {
    name: "replan_trip",
    description: "针对某一天按自然语言指令重新规划交通与顺序；只生成提案，不直接修改行程",
    parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false },
    isProposal: true,
    async execute(args, ctx) {
      return ctx.runtime.execute("replan-trip", commandSchemas["replan-trip"].parse({ tripId: ctx.tripId, instruction: args.instruction, dayId: args.dayId, fallbackPolicy: "estimated" }));
    },
    serialize(value) {
      const data = value as Envelope;
      const proposal = data.data as Record<string, unknown> | undefined;
      return JSON.stringify({ proposalId: proposal?.proposalId, baseRevision: proposal?.baseRevision, summary: proposal?.summary, strategy: proposal?.strategy, note: proposalNote });
    },
  },
  {
    name: "optimize_itinerary",
    description: "对整趟行程做一键智能重排（按地理位置聚类、时间窗与偏好优化），适合「优化安排」「少走回头路」类请求；只生成提案，不直接修改行程",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    isProposal: true,
    async execute(_args, ctx) {
      return ctx.runtime.execute("optimize-itinerary", commandSchemas["optimize-itinerary"].parse({
        tripId: ctx.tripId,
        expectedTripRevision: ctx.tripRevision,
        fallbackPolicy: "estimated",
      }));
    },
    serialize(value) {
      const data = value as Envelope;
      const proposal = data.data as Record<string, unknown> | undefined;
      return JSON.stringify({ proposalId: proposal?.proposalId, baseRevision: proposal?.baseRevision, summary: proposal?.summary, strategy: proposal?.strategy, note: proposalNote });
    },
  },
  {
    name: "get_weather",
    description: "查询当前行程目的地的天气预报",
    parameters: { type: "object", properties: { dates: { type: "array", items: { type: "string", format: "date" }, maxItems: 7 } }, required: ["dates"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-weather", commandSchemas["get-weather"].parse({ destination: ctx.trip.destination, dates: args.dates, fallbackPolicy: "deny" }));
    },
    serialize: defaultSerialize,
  },
  {
    name: "retrieve_travel_knowledge",
    description: "检索城市旅行知识（地形、交通规律、经验）；仅作为背景，不替代实时数据",
    parameters: { type: "object", properties: { city: { type: "string" }, query: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["city", "query"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("retrieve-travel-knowledge", commandSchemas["retrieve-travel-knowledge"].parse({ city: args.city ?? ctx.trip.destination, query: args.query, tags: args.tags ?? [] }));
    },
    serialize(value) {
      const data = value as Envelope;
      const matches = data.data?.matches as Array<Record<string, unknown>> | undefined;
      return JSON.stringify({ matches: matches?.slice(0, 6).map((match) => ({ title: match.title, content: typeof match.content === "string" ? match.content.slice(0, 400) : match.content, tags: match.tags, confidence: match.confidence, authorityLevel: match.authorityLevel, source: match.source })), retrieval: data.data?.retrieval, warnings: data.warnings });
    },
  },
  {
    name: "search_social_travel",
    description: "搜索社交平台实时旅行内容并返回可验证 evidence（platform/sourceUrl/publishedAt/metrics/confidence）",
    parameters: { type: "object", properties: { city: { type: "string" }, query: { type: "string" }, poi: { type: "string" } }, required: ["city"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("search-social", commandSchemas["search-social"].parse({ city: args.city ?? ctx.trip.destination, query: args.query, poi: args.poi }));
    },
    serialize(value) {
      return serializeSocialEvidence(value);
    },
  },
  {
    name: "find_trending_places",
    description: "发现近期社媒热度最高的旅行地点信号",
    parameters: { type: "object", properties: { city: { type: "string" }, platform: { type: "string" } }, required: ["city"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-social-trending", commandSchemas["get-social-trending"].parse({ city: args.city ?? ctx.trip.destination, platform: args.platform }));
    },
    serialize(value) {
      return serializeSocialEvidence(value);
    },
  },
  {
    name: "get_social_evidence",
    description: "聚合某地/某 POI 的多平台社交证据与 crowd/trend 上下文",
    parameters: { type: "object", properties: { city: { type: "string" }, poi: { type: "string" }, query: { type: "string" } }, required: ["city"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-social-evidence", commandSchemas["get-social-evidence"].parse({ city: args.city ?? ctx.trip.destination, poi: args.poi, query: args.query, tripId: ctx.tripId }));
    },
    serialize(value) {
      return serializeSocialEvidence(value);
    },
  },
  {
    name: "search_travel_offers",
    description: "查询酒店、火车、机票、门票、美食或优惠；返回供应商提供的可验证结果",
    parameters: { type: "object", properties: { query: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["hotel", "train", "flight", "ticket", "restaurant", "coupon"] } } }, required: ["query"], additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("search-travel-offers", commandSchemas["search-travel-offers"].parse({ origin: ctx.trip.origin, destination: ctx.trip.destination, startDate: ctx.trip.startDate, endDate: ctx.trip.endDate, travelers: ctx.trip.travelers, budget: ctx.trip.budget, query: args.query, categories: args.categories ?? ["train", "hotel", "restaurant"] }));
    },
    serialize(value) {
      const data = value as Envelope;
      const offers = data.data?.offers as Array<Record<string, unknown>> | undefined;
      return JSON.stringify({ offers: offers?.slice(0, 12).map((offer) => ({ kind: offer.kind, title: offer.title, priceLabel: offer.priceLabel, availability: offer.availability, bookingUrl: offer.bookingUrl, provider: offer.provider, fetchedAt: offer.fetchedAt, structured: offer.structured })), providerStatus: data.providerStatus, warnings: data.warnings });
    },
  },
  {
    name: "propose_change",
    description: "根据用户指令生成行程修改提案；只生成 Diff，不直接修改行程",
    parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false },
    isProposal: true,
    async execute(args, ctx) {
      return ctx.runtime.execute("propose-change", commandSchemas["propose-change"].parse({ tripId: ctx.tripId, instruction: args.instruction, dayId: args.dayId, fallbackPolicy: "estimated" }));
    },
    serialize(value) {
      const data = value as Envelope;
      const proposal = data.data as Record<string, unknown> | undefined;
      return JSON.stringify({ proposalId: proposal?.proposalId, baseRevision: proposal?.baseRevision, summary: proposal?.summary, strategy: proposal?.strategy, note: proposalNote });
    },
  },
  {
    name: "apply_change",
    description: "应用一个已生成的提案；必须由用户在 Diff 确认界面确认后由系统调用，LLM 不得自行调用",
    parameters: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"], additionalProperties: false },
    async execute() {
      // Confirmation discipline: the LLM may never apply a change. It
      // can only point the user to the Diff confirmation UI.
      return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "apply_change 必须由用户在 Diff 确认界面确认后由系统调用；请使用 propose_change 生成提案" } };
    },
    serialize: defaultSerialize,
    summary() {
      return "已拒绝：提案必须由用户确认";
    },
  },
  {
    name: "get_trip_state",
    description: "读取行程当前执行状态：阶段、当前/下一站、晚点分钟数、剩余步行、预计结束时间、进行中的预订与事件、风险等级",
    parameters: { type: "object", properties: { asOf: { type: "string" } }, additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-trip-state", commandSchemas["get-trip-state"].parse({ tripId: ctx.tripId, ...(args.asOf ? { asOf: args.asOf } : {}) }));
    },
    serialize(value) {
      const data = value as Envelope;
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
    },
  },
  {
    name: "get_reservations",
    description: "查询行程的预订列表（航班/高铁/酒店/餐厅/门票等）及其状态",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["tentative", "confirmed", "cancelled", "completed"] }, type: { type: "string", enum: ["flight", "train", "hotel", "restaurant", "attraction", "activity", "car", "transfer", "other"] } }, additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-reservations", commandSchemas["get-reservations"].parse({ tripId: ctx.tripId, ...(args.status ? { status: args.status } : {}), ...(args.type ? { type: args.type } : {}) }));
    },
    serialize(value) {
      const data = value as Envelope;
      const reservations = data.data?.reservations as Array<Record<string, unknown>> | undefined;
      return JSON.stringify({ reservations: reservations?.slice(0, 10).map((item) => ({ id: item.id, type: item.type, title: item.title, status: item.status, startAt: item.startAt, endAt: item.endAt ?? null, confirmationCode: item.confirmationCode ?? null })), total: data.data?.total });
    },
  },
  {
    name: "get_active_events",
    description: "读取当前生效的旅行事件（天气变化、航班延误、景点关闭、用户晚点等）",
    parameters: { type: "object", properties: { asOf: { type: "string" } }, additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-active-events", commandSchemas["get-active-events"].parse({ tripId: ctx.tripId, includeAcknowledged: true, ...(args.asOf ? { asOf: args.asOf } : {}) }));
    },
    serialize(value) {
      const data = value as Envelope;
      const events = data.data?.events as Array<Record<string, unknown>> | undefined;
      return JSON.stringify({ events: events?.slice(0, 10).map((item) => ({ id: item.id, type: item.type, severity: item.severity, summary: item.summary ?? null })), total: data.data?.total });
    },
  },
  {
    name: "get_constraints",
    description: "读取约束引擎视图：已确认预订产生的硬约束、违规项与评分",
    parameters: { type: "object", properties: { dayId: { type: "string" } }, additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("get-constraints", commandSchemas["get-constraints"].parse({ tripId: ctx.tripId, ...(args.dayId ? { dayId: args.dayId } : {}) }));
    },
    serialize(value) {
      const data = value as Envelope;
      return JSON.stringify({
        score: data.data?.score,
        hardViolations: data.data?.hardViolations,
        softPenaltyCount: Array.isArray(data.data?.softPenalties) ? (data.data?.softPenalties as unknown[]).length : 0,
        unresolvedConstraints: data.data?.unresolvedConstraints,
      });
    },
  },
  {
    name: "analyze_event_impact",
    description: "分析一个事件对行程的影响：受影响/有风险/无法完成的安排、时间与预算影响、可选策略（只读，不修改）",
    parameters: { type: "object", properties: { eventId: { type: "string" }, event: { type: "object", properties: { type: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "critical"] }, effectiveFrom: { type: "string" }, effectiveUntil: { type: "string" }, summary: { type: "string" }, payload: { type: "object" } } }, asOf: { type: "string" } }, additionalProperties: false },
    async execute(args, ctx) {
      return ctx.runtime.execute("analyze-event-impact", commandSchemas["analyze-event-impact"].parse({
        tripId: ctx.tripId,
        ...(args.eventId ? { eventId: args.eventId } : {}),
        ...(args.event ? { event: args.event } : {}),
        ...(args.asOf ? { asOf: args.asOf } : {}),
      }));
    },
    serialize(value) {
      return serializeEventImpact(value);
    },
  },
  {
    name: "propose_event_replan",
    description: "事件驱动的重规划：基于事件影响生成整体重排提案（Diff），必须由用户确认后应用；已确认预订的安排会被自动保护",
    parameters: { type: "object", properties: { eventId: { type: "string" }, event: { type: "object", properties: { type: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "critical"] }, effectiveFrom: { type: "string" }, effectiveUntil: { type: "string" }, summary: { type: "string" }, payload: { type: "object" } } }, asOf: { type: "string" }, strategy: { type: "string", enum: ["auto", "shift", "skip", "indoorSwap", "replace", "release", "reduceWalking", "reduceBudget", "swapMode", "monitor"] } }, additionalProperties: false },
    isProposal: true,
    async execute(args, ctx) {
      return ctx.runtime.execute("propose-event-replan", commandSchemas["propose-event-replan"].parse({
        tripId: ctx.tripId,
        ...(args.eventId ? { eventId: args.eventId } : {}),
        ...(args.event ? { event: args.event } : {}),
        ...(args.asOf ? { asOf: args.asOf } : {}),
        ...(args.strategy ? { strategy: args.strategy } : {}),
        fallbackPolicy: "estimated",
      }));
    },
    serialize(value) {
      const data = value as Envelope;
      const proposal = data.data as Record<string, unknown> | undefined;
      return JSON.stringify({ proposalId: proposal?.proposalId, baseRevision: proposal?.baseRevision, summary: proposal?.summary, strategy: proposal?.strategy, note: proposalNote });
    },
  },
];

export const agentToolsByName: Record<string, AgentTool> = Object.fromEntries(agentTools.map((tool) => [tool.name, tool]));

function transportContextFromArgs(args: Record<string, unknown>) {
  const context: Record<string, unknown> = {};
  if (typeof args.walkingTolerance === "string") context.walkingTolerance = args.walkingTolerance;
  if (typeof args.fatigue === "string") context.fatigue = args.fatigue;
  if (typeof args.weather === "string") context.weather = args.weather;
  return Object.keys(context).length ? context : undefined;
}

function serializeSocialEvidence(value: unknown) {
  const data = value as Envelope;
  const evidence = data.data?.evidence as Array<Record<string, unknown>> | undefined;
  const context = data.data?.context as Record<string, unknown> | undefined;
  return JSON.stringify({ evidence: evidence?.slice(0, 8).map((item) => ({ platform: item.platform, sourceId: item.sourceId, sourceUrl: item.sourceUrl, summary: item.summary, publishedAt: item.publishedAt, fetchedAt: item.fetchedAt, confidence: item.confidence, metrics: item.metrics, poiMatches: item.poiMatches })), crowdRisk: context?.crowdRisk, recentTrend: context?.recentTrend, providerStatus: data.providerStatus, warnings: data.warnings });
}

function serializeEventImpact(value: unknown) {
  const data = value as Envelope;
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
