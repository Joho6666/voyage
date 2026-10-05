
import { z } from "zod";
import { offerKindSchema } from "@/schemas/offers";
import type { ProviderStatus } from "@/skill/contracts";
import type { Trip } from "@/types/travel";
import { createRuntime } from "@/skill/runtime";

/**
 * Compatibility boundary for older Web callers. The business pipeline lives in
 * VoyageSkillRuntime; this module only validates the legacy request shape and
 * translates it to the shared command input.
 */
export const createTripWebRequestSchema = z.object({
  prompt: z.string().max(2000).optional(),
  origin: z.string().max(60).optional(),
  destination: z.string().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travelers: z.number().int().min(1).max(20).optional(),
  budget: z.number().min(0).max(1_000_000).optional(),
  vibes: z.array(z.string().max(30)).max(12).optional(),
  includeExternalOffers: z.boolean().default(false),
  includeSocialEvidence: z.boolean().default(false),
  offerCategories: z.array(offerKindSchema).max(6).optional(),
});

export type CreateTripWebRequest = z.output<typeof createTripWebRequestSchema>;

interface CreateTripEnvelope {
  data: { trip: Trip };
  providerStatus: ProviderStatus;
  warnings: string[];
}

export async function planTripFromRequest(
  body: CreateTripWebRequest,
  dataDir?: string,
): Promise<{
  source: "llm" | "rules";
  mapProvider: "amap" | "demo";
  trip: Trip;
  providerStatus: ProviderStatus;
  warnings: string[];
}> {
  const result = await createRuntime(dataDir).createTrip({
    prompt: body.prompt ?? "",
    origin: body.origin ?? "",
    destination: body.destination,
    startDate: body.startDate,
    endDate: body.endDate,
    people: body.travelers ?? 2,
    travelers: body.travelers ?? 2,
    budget: body.budget ?? 2500,
    preferences: body.vibes ?? [],
    vibes: body.vibes ?? [],
    includeExternalOffers: body.includeExternalOffers,
    includeSocialEvidence: body.includeSocialEvidence,
    ...(body.offerCategories ? { offerCategories: body.offerCategories } : {}),
    fallbackPolicy: "estimated",
  }) as CreateTripEnvelope;
  const trip = result.data.trip;
  return {
    source: trip.planningMetadata?.source ?? "rules",
    mapProvider: result.providerStatus.places === "REAL" ? "amap" : "demo",
    trip,
    providerStatus: result.providerStatus,
    warnings: result.warnings,
  };
}
