import type { TravelAgent } from "./types";
import { OpenAITravelAgent } from "./openai";

/**
 * Single TravelAgent entrypoint. The OpenAI-compatible adapter calls
 * server routes that fall back to the deterministic MockTravelAgent logic
 * when LLM_BASE_URL is not configured, so demo mode keeps working offline.
 */
export const travelAgent: TravelAgent = new OpenAITravelAgent();

export type { TravelAgent, AgentMessage, AgentProposal, CreateTripInput, GenerationStep } from "./types";
export { MockTravelAgent } from "./mock";
export { OpenAITravelAgent } from "./openai";
