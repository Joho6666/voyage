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
          offerCategories: input.offerCategories, fallbackPolicy: "deny",
        } }),
      });
      const envelope = await response.json() as { ok?: boolean; data?: { trip?: Trip }; error?: { code?: string } };
      if (!response.ok || !envelope.ok || !envelope.data?.trip) {
        throw new Error(envelope.error?.code ?? `Trip creation failed (${response.status})`);
      }
      return envelope.data.trip;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Trip creation failed");
    }
  }

  override async chat(trip: Trip, message: string): Promise<AgentMessage> {
    try {
      const marker = /^\[dayId:([^\]]+)\]\s*/.exec(message);
      const instruction = marker ? message.slice(marker[0].length) : message;
      const response = await fetch("/api/voyage/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "propose-change", input: { tripId: trip.id, instruction, dayId: marker?.[1], fallbackPolicy: "estimated" } }),
      });
      const envelope = await response.json() as { ok?: boolean; data?: { proposalId?: string; tripId?: string; baseRevision?: number; changes?: import("@/types/diff").TripChangeSet; summary?: string } };
      const data = envelope.data;
      if (!response.ok || !envelope.ok || !data?.proposalId || !data.changes) {
        throw new Error("无法生成真实行程提案，请检查服务状态");
      }
      const summary = data.summary || "已生成行程修改建议";
      return {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: `${summary}（已生成待确认方案，尚未修改行程）`,
        proposal: {
          id: `prop_${Date.now()}`,
          summary,
          apply: (current) => current,
          changeSet: data.changes,
          remote: { tripId: data.tripId!, proposalId: data.proposalId, baseRevision: data.baseRevision! },
        },
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error("无法生成真实行程提案");
    }
  }
}

export { executeActions };
