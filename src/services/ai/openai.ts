import { executeActions } from "@/services/ai/actions/executor";
import type { AgentMessage, CreateTripInput, TravelAgent } from "./types";
import { MockTravelAgent } from "./mock";
import type { Trip } from "@/types/travel";

export interface PlanActionsResponse {
  source: "llm" | "mock";
  summary?: string;
  applied: unknown[];
  rejected: Array<{ action: unknown; reason: string }>;
  trip: Trip;
  persistError?: string;
}

/**
 * Real agent: all intelligence runs server-side (/api/agent/*). When the LLM is
 * not configured the route itself falls back to deterministic rule-based
 * planning, so this class never needs to call the LLM directly from the client.
 */
export class OpenAITravelAgent extends MockTravelAgent implements TravelAgent {
  readonly id = "openai" as const;

  override async createTrip(input: CreateTripInput): Promise<Trip> {
    try {
      const response = await fetch("/api/voyage/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "create-trip", input: {
          prompt: input.prompt,
          origin: input.origin,
          destination: input.destination ?? "重庆",
          startDate: input.startDate ?? "2026-09-20",
          endDate: input.endDate ?? "2026-09-22",
          travelers: input.travelers ?? 2,
          budget: input.budget ?? 2500,
          vibes: input.vibes ?? [], preferences: input.vibes ?? [],
          includeExternalOffers: input.includeExternalOffers ?? false,
          offerCategories: input.offerCategories, fallbackPolicy: "estimated",
        } }),
      });
      const envelope = await response.json() as { ok?: boolean; data?: { trip?: Trip }; error?: { code?: string; message?: string } };
      if (!response.ok || !envelope.ok || !envelope.data?.trip) {
        throw new Error(envelope.error?.code ? `${envelope.error.code}${envelope.error.message ? `: ${envelope.error.message}` : ""}` : `Trip creation failed (${response.status})`);
      }
      return envelope.data.trip;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Trip creation failed");
    }
  }

  override async chat(trip: Trip, message: string): Promise<AgentMessage> {
    try {
      const response = await fetch("/api/agent/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId: trip.id, message }),
      });
      const envelope = await response.json() as { ok?: boolean; content?: string; toolsUsed?: string[]; proposal?: { data?: { proposalId?: string; tripId?: string; baseRevision?: number; changes?: import("@/types/diff").TripChangeSet; summary?: string } }; error?: string };
      if (!response.ok || !envelope.ok) throw new Error(envelope.error ?? "AI 工具调用失败");
      const data = envelope.proposal?.data;
      const summary = data?.summary || envelope.content || "已完成查询";
      return {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: `${summary}${envelope.toolsUsed?.length ? `\n已调用：${envelope.toolsUsed.join("、")}` : ""}${data?.proposalId ? "（修改方案待确认）" : ""}`,
        proposal: data?.proposalId && data.changes ? {
          id: `prop_${Date.now()}`,
          summary,
          apply: (current) => current,
          changeSet: data.changes,
          remote: { tripId: data.tripId!, proposalId: data.proposalId, baseRevision: data.baseRevision! },
        } : undefined,
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error("无法生成真实行程提案");
    }
  }
}

export { executeActions };
