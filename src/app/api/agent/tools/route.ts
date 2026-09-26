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

const inputSchema = z.object({ tripId: z.string().min(1), message: z.string().min(1).max(2000) });

const tools: LlmTool[] = [
  { type: "function", function: { name: "get_trip", description: "读取当前旅行的权威行程、地点和日期", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "search_places", description: "查询目的地真实地点、餐厅、酒店或活动 POI", parameters: { type: "object", properties: { query: { type: "string" }, category: { type: "string", enum: ["attraction", "food", "cafe", "hotel", "activity", "shopping", "transport", "viewpoint"] }, limit: { type: "integer", minimum: 1, maximum: 12 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "get_weather", description: "查询当前行程目的地的天气预报", parameters: { type: "object", properties: { dates: { type: "array", items: { type: "string", format: "date" }, maxItems: 7 } }, required: ["dates"], additionalProperties: false } } },
  { type: "function", function: { name: "search_travel_offers", description: "查询酒店、火车、机票、门票、美食或优惠；返回供应商提供的可验证结果", parameters: { type: "object", properties: { query: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["hotel", "train", "flight", "ticket", "restaurant", "coupon"] } } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "propose_change", description: "根据用户指令生成行程修改提案；只生成 Diff，不直接修改行程", parameters: { type: "object", properties: { instruction: { type: "string" }, dayId: { type: "string" } }, required: ["instruction"], additionalProperties: false } } },
];

function safeToolResult(name: string, value: unknown) {
  const data = value as { data?: Record<string, unknown>; providerStatus?: unknown; warnings?: unknown };
  if (name === "get_trip") {
    const trip = data.data?.trip as TripSummary | undefined;
    return JSON.stringify({ destination: trip?.destination, origin: trip?.origin, dates: trip?.days?.map((day) => ({ id: day.id, date: day.date, title: day.title })), places: trip?.places?.slice(0, 20).map((place) => ({ name: place.name, category: place.category })) });
  }
  if (name === "search_places") {
    const places = data.data?.places as Array<Record<string, unknown>> | undefined;
    return JSON.stringify({ places: places?.slice(0, 12).map((place) => ({ name: place.name, address: place.address, category: place.category, source: place.source, rating: place.rating, priceLabel: place.priceLabel })), providerStatus: data.providerStatus, warnings: data.warnings });
  }
  if (name === "search_travel_offers") {
    const offers = data.data?.offers as Array<Record<string, unknown>> | undefined;
    return JSON.stringify({ offers: offers?.slice(0, 12).map((offer) => ({ kind: offer.kind, title: offer.title, priceLabel: offer.priceLabel, availability: offer.availability, bookingUrl: offer.bookingUrl, provider: offer.provider, fetchedAt: offer.fetchedAt, structured: offer.structured })), providerStatus: data.providerStatus, warnings: data.warnings });
  }
  return JSON.stringify(value, (_key, item) => typeof item === "string" && item.length > 600 ? `${item.slice(0, 600)}…` : item);
}

type TripSummary = { destination?: string; origin?: string; days?: Array<{ id: string; date: string; title?: string }>; places?: Array<{ name: string; category: string }> };

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
    { role: "system", content: `你是 Voyage 旅行助手。用中文回答。你可以调用白名单工具获取真实数据。不要编造价格、库存、天气或地点。行程修改只能生成提案，必须让用户确认后才能应用。当前行程：${trip.origin ?? ""} → ${trip.destination ?? ""}，${trip.startDate ?? ""} 至 ${trip.endDate ?? ""}，${trip.travelers ?? 1} 人，预算 ${trip.budget ?? 0} 元。` },
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
        if (!(call.name in { get_trip: true, search_places: true, get_weather: true, search_travel_offers: true, propose_change: true })) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Tool is not allowed" }) });
          continue;
        }
        toolTrace.push(call.name);
        const args = call.arguments as Record<string, unknown>;
        let result: unknown;
        try {
          if (call.name === "get_trip") result = tripEnvelope;
          else if (call.name === "search_places") result = await runtime.execute("search-places", commandSchemas["search-places"].parse({ destination: trip.destination, query: args.query, category: args.category, limit: args.limit ?? 8 }));
          else if (call.name === "get_weather") result = await runtime.execute("get-weather", commandSchemas["get-weather"].parse({ destination: trip.destination, dates: args.dates, fallbackPolicy: "deny" }));
          else if (call.name === "search_travel_offers") result = await runtime.execute("search-travel-offers", commandSchemas["search-travel-offers"].parse({ origin: trip.origin, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, budget: trip.budget, query: args.query, categories: args.categories ?? ["train", "hotel", "restaurant"] }));
          else {
            result = await runtime.execute("propose-change", commandSchemas["propose-change"].parse({ tripId: parsed.data.tripId, instruction: args.instruction, dayId: args.dayId, fallbackPolicy: "estimated" }));
            proposal = result;
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
