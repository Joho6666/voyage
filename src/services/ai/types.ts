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
  remote?: { tripId: string; proposalId: string; baseRevision: number };
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: AgentProposal;
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
  chat(trip: Trip, message: string): Promise<AgentMessage>;
}
