import { z } from "zod";
import { offerKindSchema } from "@/schemas/offers";

export const SCHEMA_VERSION = "voyage.skill.v1" as const;
export type ProviderLevel = "REAL" | "ESTIMATED" | "MOCK" | "UNKNOWN" | "UNAVAILABLE" | "UNSTRUCTURED" | "PERMISSION_REQUIRED";

export interface ProviderStatus {
  overall: ProviderLevel;
  places: ProviderLevel;
  routes: ProviderLevel;
  weather: ProviderLevel;
  travelOffers: ProviderLevel;
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
    includeExternalOffers: z.boolean().default(false),
    offerCategories: z.array(offerKindSchema).max(6).default(["train", "hotel", "ticket", "restaurant", "coupon"]),
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

const urbanTransportModeSchema = z.enum(["walk", "metro", "bus", "taxi", "drive"]);

export const transportContextSchema = z.object({
  budgetSensitivity: z.enum(["low", "medium", "high"]).optional(),
  walkingTolerance: z.enum(["low", "medium", "high"]).optional(),
  fatigue: z.enum(["low", "medium", "high"]).optional(),
  weather: z.enum(["clear", "rain", "heat", "cold", "unknown"]).optional(),
  travelers: z.number().int().min(1).max(20).optional(),
  hasLuggage: z.boolean().optional(),
  accessibilityNeeds: z.boolean().optional(),
}).default({});

export const getRouteOptionsInputSchema = z.object({
  origin: point,
  destination: point,
  city: z.string().min(1).max(80),
  modes: z.array(urbanTransportModeSchema).min(1).max(5).optional(),
  context: transportContextSchema,
  fallbackPolicy: fallbackPolicySchema,
});

export const optimizeTransportInputSchema = getRouteOptionsInputSchema;

export const retrieveTravelKnowledgeInputSchema = z.object({
  city: z.string().min(1).max(80),
  query: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(80)).max(20).default([]),
  limit: z.number().int().min(1).max(20).default(8),
});

export const replanTripInputSchema = z.object({
  tripId: z.string().min(1),
  dayId: z.string().optional(),
  instruction: z.string().max(2000).optional(),
  context: transportContextSchema,
  fallbackPolicy: fallbackPolicySchema,
});

export const searchFlightsInputSchema = z.object({
  departureCityCode: z.string().regex(/^[A-Z]{3}$/),
  arrivalCityCode: z.string().regex(/^[A-Z]{3}$/),
  departureDate: isoDate,
  returnDate: isoDate.optional(),
  tripType: z.union([z.literal(1), z.literal(2)]).default(1),
  cabinClass: z.enum(["ALL_CABIN", "Y", "FC", "F", "C"]).default("ALL_CABIN"),
  externalAgentName: z.string().min(1).max(80),
  searchMode: z.union([z.literal(0), z.literal(2)]).default(2),
  hasChild: z.boolean().default(false),
  hasInfant: z.boolean().default(false),
});

export const searchTravelOffersInputSchema = z.object({
  origin: z.string().max(80).optional(),
  destination: z.string().min(1).max(80),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  travelers: z.number().int().min(1).max(20).default(1),
  budget: z.number().min(0).max(1_000_000).optional(),
  query: z.string().min(1).max(2000),
  city: z.string().max(80).optional(),
  categories: z.array(offerKindSchema).max(6).default(["train", "hotel", "ticket", "restaurant", "coupon"]),
});

export const refreshTravelOffersInputSchema = searchTravelOffersInputSchema.extend({
  tripId: z.string().min(1),
  expectedTripRevision: z.number().int().min(1),
});

export const reorderDayInputSchema = z.object({
  tripId: z.string().min(1),
  dayId: z.string().min(1),
  orderedItemIds: z.array(z.string().min(1)).min(1).max(30),
  expectedTripRevision: z.number().int().min(1),
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
  "get-route-options": getRouteOptionsInputSchema,
  "optimize-transport": optimizeTransportInputSchema,
  "retrieve-travel-knowledge": retrieveTravelKnowledgeInputSchema,
  "replan-trip": replanTripInputSchema,
  "get-weather": getWeatherInputSchema,
  "search-flights": searchFlightsInputSchema,
  "search-travel-offers": searchTravelOffersInputSchema,
  "refresh-travel-offers": refreshTravelOffersInputSchema,
  "reorder-day": reorderDayInputSchema,
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
