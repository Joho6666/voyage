import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chatWithTools, type ChatMessage, type LlmTool } from "@/services/ai/llm";
import { createRuntime } from "@/skill/runtime";
import { commandSchemas } from "@/skill/contracts";
import { guestWorkspace, setGuestCookie } from "@/app/api/voyage/workspace";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  tripId: z.string().min(1),
  message: z.string().min(1).max(2000),
  applyConfirmation: z.object({
    proposalId: z.string().min(1),
    expectedTripRevision: z.number().int().min(1),
  }).optional(),
});

const pointSchema = { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"], additionalProperties: false } as const;

const tools: LlmTool[] = [
  { type: "function", function: { name: "get_trip", description: "读取当前旅行的权威行程、地点（含坐标）和日期", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "search_places", description: "查询目的地真实地点、餐厅、酒店或活动 POI", parameters: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: ["attraction", "food", "cafe", "hotel", "activity", "shopping", "transport", "viewpoint"] }, limit: { type: "integer", minimum: 1, maximum: 12 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "get_place", description: "查询单个地点详情；可用行程内 placeId，或名称+城市从真实 POI 查询", parameters: { type: "object", properties: { placeId: { type: "string" }, name: { type: "string" }, city: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "plan_route", description: "在两个坐标之间规划单一路线（walk/metro/bus/taxi/drive）", parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, mode: { type: "string", enum: ["walk", "metro", "bus", "taxi", "drive"] }, city: { type: "string" } }, required: ["origin", "destination", "city"], additionalProperties: false } } },
  { type: "function", function: { name: "get_route_options", description: "返回多模式交通候选与结构化评分（步行、费用、换乘、天气等）", parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, city: { type: "string" }, walkingTolerance: { type: "string", enum: ["low", "medium", "high"] }, weather: { type: "string", enum: ["clear", "rain", "heat", "cold", "unknown"] } }, required: ["origin", "destination", "city"], additionalProperties: false } } },
  { type: "function", function: { name: "optimize_transport", description: "结合知识与上下文推荐最优市内交通方式，返回 rankedOptions 与解释", parameters: { type: "object", properties: { origin: pointSchema, destination: pointSchema, city: { type: "string" }, walkingTolerance: { type: "string", enum: ["low", "medium", "high"] }, fatigue: { type: "string", enum: ["low", "medium", "high"] }, weather: { type: "string", enum: ["clear", "rain", "heat", "cold", "unknown"] } }, required: ["origin", "destination", "city"], additionalProperties: false } } },
  { type: "function", function: { name: "replan_trip", description: "针对某一天按自然语言指令重新规划交通与顺序；只生成提案，不直接修改行程", parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false } } },
  { type: "function", function: { name: "get_weather", description: "查询当前行程目的地的天气预报", parameters: { type: "object", properties: { dates: { type: "array", items: { type: "string", format: "date" }, maxItems: 7 } }, required: ["dates"], additionalProperties: false } } },
  { type: "function", function: { name: "retrieve_travel_knowledge", description: "检索城市旅行知识（地形、交通规律、经验）；仅作为背景，不替代实时数据", parameters: { type: "object", properties: { city: { type: "string" }, query: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["city", "query"], additionalProperties: false } } },
  { type: "function", function: { name: "search_social_travel", description: "搜索社交平台实时旅行内容并返回可验证 evidence（platform/sourceUrl/publishedAt/metrics/confidence）", parameters: { type: "object", properties: { city: { type: "string" }, query: { type: "string" }, poi: { type: "string" } }, required: ["city"], additionalProperties: false } } },
  { type: "function", function: { name: "find_trending_places", description: "发现近期社媒热度最高的旅行地点信号", parameters: { type: "object", properties: { city: { type: "string" }, platform: { type: "string" } }, required: ["city"], additionalProperties: false } } },
  { type: "function", function: { name: "get_social_evidence", description: "聚合某地/某 POI 的多平台社交证据与 crowd/trend 上下文", parameters: { type: "object", properties: { city: { type: "string" }, poi: { type: "string" }, query: { type: "string" } }, required: ["city"], additionalProperties: false } } },
  { type: "function", function: { name: "search_travel_offers", description: "查询酒店、火车、机票、门票、美食或优惠；返回供应商提供的可验证结果", parameters: { type: "object", properties: { query: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["hotel", "train", "flight", "ticket", "restaurant", "coupon"] } } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "propose_change", description: "根据用户指令生成行程修改提案；只生成 Diff，不直接修改行程", parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false } } },
  { type: "function", function: { name: "apply_change", description: "应用一个已生成的提案；必须由用户在 Diff 确认界面确认后由系统调用，LLM 不得自行调用", parameters: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"], additionalProperties: false } } },
];

const allowedToolNames: Record<string, true> = Object.fromEntries(tools.map((tool) => [tool.function.name, true as const]));

function safeToolResult(name: string, value: unknown) {
  const data = value as { data?: Record<string, unknown>; providerStatus?: unknown; warnings?: unknown };
  if (name === "get_trip") {
    const trip = data.data?.trip as TripSummary | undefined;
    return JSON.stringify({ destination: trip?.destination, origin: trip?.origin, dates: trip?.days?.map((day) => ({ id: day.id, date: day.date, title: day.title })), places: trip?.places?.slice(0, 20).map((place) => ({ name: place.name, category: place.category, lat: place.lat, lng: place.lng, id: place.id })) });
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
  if (name === "replan_trip" || name === "propose_change") {
    const proposal = data.data as Record<string, unknown> | undefined;
    return JSON.stringify({ proposalId: proposal?.proposalId, baseRevision: proposal?.baseRevision, summary: proposal?.summary, note: "提案已生成，必须由用户在 Diff 界面确认后才能应用" });
  }
  return JSON.stringify(value, (_key, item) => typeof item === "string" && item.length > 600 ? `${item.slice(0, 600)}…` : item);
}

type TripSummary = { destination?: string; origin?: string; days?: Array<{ id: string; date: string; title?: string }>; places?: Array<{ name: string; category: string; lat?: number; lng?: number; id?: string }> };

function transportContextFromArgs(args: Record<string, unknown>) {
  const context: Record<string, unknown> = {};
  if (typeof args.walkingTolerance === "string") context.walkingTolerance = args.walkingTolerance;
  if (typeof args.fatigue === "string") context.fatigue = args.fatigue;
  if (typeof args.weather === "string") context.weather = args.weather;
  return Object.keys(context).length ? context : undefined;
}

export async function POST(request: NextRequest) {
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
  const tripEnvelope = await runtime.execute("get-trip", { tripId: parsed.data.tripId }) as { data?: { trip?: { destination?: string; origin?: string; startDate?: string; endDate?: string; travelers?: number; budget?: number; days?: Array<{ id: string; date: string }> } } };
  const trip = tripEnvelope.data?.trip;
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found" }, { status: 404 });

  // Explicit user confirmation path: the client posts applyConfirmation after
  // the user accepted a Diff in the UI. The LLM loop can never mint this.
  if (parsed.data.applyConfirmation) {
    try {
      const result = await runtime.execute("apply-change", { tripId: parsed.data.tripId, proposalId: parsed.data.applyConfirmation.proposalId, expectedTripRevision: parsed.data.applyConfirmation.expectedTripRevision, confirmed: true });
      return setGuestCookie(NextResponse.json({ ok: true, content: "已应用用户确认的修改", toolsUsed: ["apply_change"], proposal: result }), workspace);
    } catch (error) {
      return setGuestCookie(NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "应用失败" }, { status: 422 }), workspace);
    }
  }

  if (process.env.VOYAGE_DEMO_MODE === "true" &&
    /少走|走路|太累|下雨|雨方案|推迟|跳过|省100|换个地方/.test(parsed.data.message)) {
    try {
      const dayId = parsed.data.message.match(/\[dayId:([^\]]+)\]/)?.[1];
      const proposal = await runtime.execute("propose-change", commandSchemas["propose-change"].parse({
        tripId: parsed.data.tripId, instruction: parsed.data.message, dayId, fallbackPolicy: "estimated",
      }));
      return setGuestCookie(NextResponse.json({ ok: true, content: "已生成行程修改建议", toolsUsed: ["propose_change"], proposal }), workspace);
    } catch (error) {
      return setGuestCookie(NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "无法生成提案" }, { status: 422 }), workspace);
    }
  }
  const messages: ChatMessage[] = [
    { role: "system", content: `你是 Voyage 旅行助手。用中文回答。你可以调用白名单工具获取真实数据。不要编造价格、库存、天气或地点。行程修改只能生成提案，必须让用户确认后才能应用；禁止自行调用 apply_change。当前行程：${trip.origin ?? ""} → ${trip.destination ?? ""}，${trip.startDate ?? ""} 至 ${trip.endDate ?? ""}，${trip.travelers ?? 1} 人，预算 ${trip.budget ?? 0} 元。` },
    { role: "user", content: parsed.data.message },
  ];
  let proposal: unknown;
  const toolTrace: string[] = [];
  try {
    for (let round = 0; round < 3; round += 1) {
      const answer = await chatWithTools({ messages, tools });
      if (!answer.toolCalls.length) return setGuestCookie(NextResponse.json({ ok: true, content: answer.content, toolsUsed: toolTrace, proposal }), workspace);
      messages.push({ role: "assistant", content: answer.content || null, tool_calls: answer.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
      for (const call of answer.toolCalls) {
        if (!(call.name in allowedToolNames)) {
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
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: safeToolResult(call.name, result) });
        } catch (error) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 200) : "Tool failed" }) });
        }
      }
    }
    return setGuestCookie(NextResponse.json({ ok: false, error: "TOOL_LOOP_LIMIT", toolsUsed: toolTrace }, { status: 422 }), workspace);
  } catch (error) {
    return setGuestCookie(NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Tool call failed", toolsUsed: toolTrace }, { status: 502 }), workspace);
  }
}
