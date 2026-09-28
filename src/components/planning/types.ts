export type PlanningMessageRole = "user" | "assistant" | "system";

export interface PlanningMessage {
  id: string;
  role: PlanningMessageRole;
  content: string;
  createdAt?: string;
}

export interface PlanningProfileDraft {
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  travelers: string;
  budget: string;
  vibes: string[];
  pace: string;
  walkingTolerance: string;
  transportPreference: string;
  mustVisit: string;
  avoid: string;
  includeOffers: boolean;
  includeSocialEvidence: boolean;
}

export type PlanningLlmState = "ready" | "fallback" | "unavailable" | "error" | "unknown";

export interface PlanningLlmStatus {
  state: PlanningLlmState;
  label?: string;
  provider?: string;
  model?: string;
  reason?: string;
}
