import { executeActions } from "@/services/ai/actions/executor";
import type { TravelAction } from "@/services/ai/actions/types";
import { computeTripChangeSet } from "@/services/ai/diff";
import type { AgentMessage, CreateTripInput, TravelAgent } from "./types";
import { MockTravelAgent } from "./mock";
import type { Trip } from "@/types/travel";
import { recomputeTripWithRealRoutes } from "@/services/routing";

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
      const response = await fetch("/api/agent/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          origin: input.origin,
          destination: input.destination ?? "重庆",
          startDate: input.startDate ?? "2026-09-20",
          endDate: input.endDate ?? "2026-09-22",
          travelers: input.travelers ?? 2,
          budget: input.budget ?? 2500,
          vibes: input.vibes ?? [],
        }),
      });
      const data = (await response.json()) as { trip?: Trip; error?: string };
      if (!response.ok || !data.trip) {
        throw new Error(data.error ?? `Trip creation failed (${response.status})`);
      }
      return await recomputeTripWithRealRoutes(data.trip);
    } catch (error) {
      throw error instanceof Error ? error : new Error("Trip creation failed");
    }
  }

  override async chat(trip: Trip, message: string): Promise<AgentMessage> {
    try {
      const response = await fetch("/api/agent/plan-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip, message, persist: true }),
      });
      const data = (await response.json()) as PlanActionsResponse;
      if (!response.ok || !data.trip) {
        return super.chat(trip, message);
      }
      const rejectedNote = data.rejected.length
        ? `${data.rejected.length} 个操作被拒绝。`
        : "";
      const summary = data.summary || `已执行 ${data.applied.length} 个操作。${rejectedNote}`;
      const routedTrip = await recomputeTripWithRealRoutes(data.trip);
      const changeSet = computeTripChangeSet(
        trip,
        routedTrip,
        (data.applied as TravelAction[]) || [],
        summary,
      );
      return {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: `${summary}（来源：${data.source === "llm" ? "LLM" : "规则引擎"}）`,
        proposal: {
          id: `prop_${Date.now()}`,
          summary,
          apply: () => routedTrip,
          changeSet,
        },
      };
    } catch {
      return super.chat(trip, message);
    }
  }
}

export { executeActions };
