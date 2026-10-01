import type { Trip } from "@/types/travel";

export interface CreateTripInput {
  prompt: string;
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  budget?: number;
  vibes?: string[];
  includeExternalOffers?: boolean;
  includeSocialEvidence?: boolean;
  offerCategories?: import("@/types/offers").OfferKind[];
}

export interface GenerationStep {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
}

export interface AgentProposal {
  id: string;
  summary: string;
  apply: (trip: Trip) => Trip;
  changeSet?: import("@/types/diff").TripChangeSet;
  /** proposalToken is the one-time credential the server minted for this
   * proposal; apply-change rejects anything without it. */
  remote?: { tripId: string; proposalId: string; baseRevision: number; proposalToken: string };
}

/** A tool call the agent made while producing this message, for UI transparency. */
export interface AgentToolCall {
  name: string;
  summary: string;
  ok: boolean;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: AgentProposal;
  /** Readable trace of the tools the model called (server-verified). */
  toolCalls?: AgentToolCall[];
  /** Non-fatal notices, e.g. partial results when the tool loop hit its cap. */
  warnings?: string[];
}

/** Bounded prior turns sent back to the server so follow-ups keep their context. */
export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TravelAgent {
  readonly id: "mock" | "openai";
  createTrip(input: CreateTripInput): Promise<Trip>;
  generationSteps(input: CreateTripInput): GenerationStep[];
  optimizeDay(trip: Trip, dayId: string): AgentProposal;
  recommendPlaces(trip: Trip): AgentProposal;
  recommendFood(trip: Trip): AgentProposal;
  recommendActivities(trip: Trip): AgentProposal;
  reduceBudget(trip: Trip): AgentProposal;
  reduceWalking(trip: Trip): AgentProposal;
  moveItem(trip: Trip, itemId: string, toDayId: string): Trip;
  removeItem(trip: Trip, itemId: string): Trip;
  addItem(trip: Trip, placeId: string, dayId: string): Trip;
  chat(trip: Trip, message: string, history?: AgentTurn[]): Promise<AgentMessage>;
}
