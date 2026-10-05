import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chatWithTools, type ChatMessage, type LlmTool } from "@/services/ai/llm";
import { createRuntime } from "@/skill/runtime";
import { commandSchemas } from "@/skill/contracts";
import { agentTools, agentToolsByName, summarizeResult, type AgentToolContext } from "./registry";
import { guestWorkspace, setGuestCookie } from "@/app/api/voyage/workspace";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import { failureMessage, toolContextMessage } from "@/lib/failure-message";
import { weatherDisplay } from "@/lib/weather-display";
import type { Trip } from "@/types/travel";
import type { PlanningProfile } from "@/schemas/planning";
import { enforceRateLimit } from "@/lib/api-guards";
import { PreferenceMemoryStore } from "@/services/memory/preferences";

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

// LLM tool schemas derive from the single registry — order is pinned by the
// agent system-prompt snapshot.
const tools: LlmTool[] = agentTools.map((tool) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));


/** What the UI shows per tool call: name + a human-readable arg/result digest. */
export interface AgentToolCallTrace {
  name: string;
  argsSummary: string;
  resultSummary: string;
  ok: boolean;
}

function summarizeArgs(args: Record<string, unknown>) {
  return Object.entries(args ?? {})
    .filter(([, value]) => value !== undefined && value !== "" && value !== null)
    .slice(0, 2)
    .map(([key, value]) => `${key}=${typeof value === "object" ? "…" : String(value).slice(0, 40)}`)
    .join(", ");
}

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
  // Phase 6.9 disclosure: when preference memory is used, the traveller must
  // see it — the line below is prefixed 「根据你的旅行偏好」 and carries each
  // entry's provenance; the prompt tells the agent to mention it explicitly.
  let memoryLine = "";
  try {
    memoryLine = (await new PreferenceMemoryStore(workspace.root).summaryLine()) ?? "";
    if (memoryLine) memoryLine = `${memoryLine}（向用户提及这条偏好依据，用户可随时要求修改或清除）`;
  } catch {
    memoryLine = "";
  }
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
    memoryLine.length ? memoryLine : "",
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
      const malformedCalls = answer.malformedToolCalls ?? [];
      if (!answer.toolCalls.length && !malformedCalls.length) return setGuestCookie(NextResponse.json({ ok: true, content: answer.content, toolsUsed: toolTrace, toolCalls, proposal }), workspace);
      // ONE assistant message carries every requested call (valid + malformed);
      // OpenAI-strict providers reject tool responses that don't follow their
      // matching assistant tool_calls, and empty tool_calls arrays entirely.
      messages.push({
        role: "assistant",
        content: answer.content || null,
        tool_calls: [
          ...answer.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
          ...malformedCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: "{}" } })),
        ],
      });
      // Un-parseable tool arguments must reach the model as a tool message —
      // silently dropping them meant the model never learned its call failed.
      for (const malformed of malformedCalls) {
        toolCalls.push({ name: malformed.name, argsSummary: "", resultSummary: "参数不是有效 JSON，已要求模型修正", ok: false });
        messages.push({ role: "tool", tool_call_id: malformed.id, content: JSON.stringify({ error: malformed.error }) });
      }
      const toolContext: AgentToolContext = {
        trip: {
          destination: trip.destination,
          origin: trip.origin,
          startDate: trip.startDate,
          endDate: trip.endDate,
          travelers: trip.travelers,
          budget: trip.budget,
        },
        tripId: parsed.data.tripId,
        tripRevision: tripEnvelope.data?.revision,
        tripEnvelope,
        runtime,
      };
      for (const call of answer.toolCalls) {
        const argsSummary = summarizeArgs(call.arguments as Record<string, unknown>);
        const tool = agentToolsByName[call.name];
        if (!tool) {
          toolCalls.push({ name: call.name, argsSummary, resultSummary: "工具不在白名单，已跳过", ok: false });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Tool is not allowed" }) });
          continue;
        }
        toolTrace.push(call.name);
        const args = call.arguments as Record<string, unknown>;
        try {
          const result = await tool.execute(args, toolContext);
          messages.push({ role: "tool", tool_call_id: call.id, content: tool.serialize(result) });
          toolCalls.push({ name: call.name, argsSummary, resultSummary: tool.summary?.(result) ?? summarizeResult(result), ok: true });
          if (tool.isProposal) proposal = result;
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
