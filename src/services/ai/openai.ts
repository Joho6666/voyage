import { assertPublicHttpUrl } from "@/lib/safe-url";
import { MockTravelAgent } from "./mock";
import type { CreateTripInput, TravelAgent } from "./types";
import type { Trip } from "@/types/travel";

export class OpenAITravelAgent extends MockTravelAgent implements TravelAgent {
  override readonly id: TravelAgent["id"] = "openai";

  override async createTrip(input: CreateTripInput): Promise<Trip> {
    const base = process.env.LLM_BASE_URL;
    if (!base) return super.createTrip(input);
    assertPublicHttpUrl(base);
    return super.createTrip(input);
  }
}
