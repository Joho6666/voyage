import { z } from "zod";

export const SCHEMA_VERSION = "voyage.skill.v1" as const;
export type ProviderLevel = "REAL" | "ESTIMATED" | "MOCK" | "UNKNOWN";

export interface ProviderStatus {
  overall: ProviderLevel;
  places: ProviderLevel;
  routes: ProviderLevel;
  weather: ProviderLevel;
}

export const fallbackPolicySchema = z.enum(["deny", "estimated"]).default("deny");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const createTripInputSchema = z
  .object({
    origin: z.string().max(80).default(""),
    destination: z.string().min(1).max(80),
    startDate: isoDate,
    endDate: isoDate.optional(),
    days: z.number().int().min(1).max(7).optional(),
    people: z.number().int().min(1).max(20).default(1),
    travelers: z.number().int().min(1).max(20).optional(),
    budget: z.number().min(0).max(1_000_000).default(2500),
    preferences: z.array(z.string().max(30)).max(12).default([]),
    vibes: z.array(z.string().max(30)).max(12).optional(),
    walkingTolerance: z.enum(["low", "medium", "high"]).default("medium"),
    prompt: z.string().max(2000).default(""),
    fallbackPolicy: fallbackPolicySchema,
  })
  .refine((value) => value.endDate || value.days, { message: "endDate or days is required" });

export const getTripInputSchema = z.object({ tripId: z.string().min(1) });

export const searchPlacesInputSchema = z.object({
  destination: z.string().min(1),
  query: z.string().default("景点"),
  category: z.enum(["attraction", "food", "cafe", "hotel", "activity", "shopping", "transport", "viewpoint"]).optional(),
  limit: z.number().int().min(1).max(50).default(12),
});

export const planRouteInputSchema = z.object({
  origin: point,
  destination: point,
  mode: z.enum(["walk", "metro", "bus", "taxi", "drive"]).default("walk"),
  city: z.string().min(1),
  fallbackPolicy: fallbackPolicySchema,
});

export const getWeatherInputSchema = z.object({
  destination: z.string().min(1),
  dates: z.array(isoDate).min(1).max(7),
  fallbackPolicy: fallbackPolicySchema,
});

export const proposeChangeInputSchema = z.object({
  tripId: z.string().min(1),
  instruction: z.string().min(1).max(2000),
  dayId: z.string().optional(),
  asOf: z.string().datetime().optional(),
  fallbackPolicy: fallbackPolicySchema,
});

export const applyChangeInputSchema = z.object({
  tripId: z.string().min(1),
  proposalId: z.string().min(1),
  expectedTripRevision: z.number().int().min(1),
  confirmed: z.literal(true),
});

export const commandSchemas = {
  "create-trip": createTripInputSchema,
  "get-trip": getTripInputSchema,
  "search-places": searchPlacesInputSchema,
  "plan-route": planRouteInputSchema,
  "get-weather": getWeatherInputSchema,
  "propose-change": proposeChangeInputSchema,
  "apply-change": applyChangeInputSchema,
} as const;

export type SkillCommand = keyof typeof commandSchemas;

export function successEnvelope(data: unknown, providerStatus?: ProviderStatus, warnings: string[] = []) {
  return { schemaVersion: SCHEMA_VERSION, ok: true as const, data, warnings, ...(providerStatus ? { providerStatus } : {}) };
}

export function errorEnvelope(code: string, message: string, details?: unknown) {
  return { schemaVersion: SCHEMA_VERSION, ok: false as const, error: { code, message, ...(details === undefined ? {} : { details }) } };
}
