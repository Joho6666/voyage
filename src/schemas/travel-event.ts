import { z } from "zod";

/**
 * TravelEvent domain (Phase 6.3).
 *
 * The single normalized shape for "something in the real world changed".
 * Provider responses are never propagated into the Runtime raw — every source
 * (weather, flight, traffic, manual user reports, simulation) normalizes into
 * a TravelEvent first. Downstream consumers (TripState, Impact Engine, replan)
 * only ever see this shape.
 *
 * Events live on the Trip payload (capped, oldest-trimmed) like reservations:
 * zero-migration rollout. id/tripId/occurredAt are runtime-assigned.
 */

export const travelEventTypeSchema = z.enum([
  "WEATHER_CHANGED",
  "HEAVY_RAIN",
  "EXTREME_HEAT",
  "FLIGHT_DELAYED",
  "FLIGHT_CANCELLED",
  "TRAIN_DELAYED",
  "ROAD_CONGESTED",
  "ROUTE_CLOSED",
  "POI_CLOSED",
  "OPENING_HOURS_CHANGED",
  "RESERVATION_CHANGED",
  "RESERVATION_CANCELLED",
  "USER_LATE",
  "USER_AHEAD",
  "WALKING_OVERLOAD",
  "BUDGET_THRESHOLD",
  "TRIP_CONSTRAINT_VIOLATED",
]);

export type TravelEventType = z.output<typeof travelEventTypeSchema>;

export const travelEventSeveritySchema = z.enum(["info", "warning", "critical"]);
export type TravelEventSeverity = z.output<typeof travelEventSeveritySchema>;

/** Where the event came from. simulation events are dev/demo only. */
export const travelEventSourceSchema = z.enum(["provider", "user", "system", "simulation"]);

export const travelEventEntitySchema = z.object({
  kind: z.enum(["reservation", "item", "place", "day", "segment", "task"]),
  id: z.string().min(1),
}).strict();

export const travelEventProvenanceSchema = z.object({
  source: travelEventSourceSchema,
  vendor: z.string().max(40).optional(),
  fetchedAt: z.string().min(10).max(40),
  /** 0-1: how sure the source is. UNKNOWN data arrives as low confidence. */
  confidence: z.number().min(0).max(1).default(0.5),
  estimated: z.boolean().default(false),
});

/**
 * A normalized real-world change. `effectiveFrom`/`effectiveUntil` express the
 * window the event applies to (a rain shower, a closure); events without a
 * window are point-in-time facts. Missing data stays missing: a POI closure of
 * unknown duration simply has no effectiveUntil — consumers must treat that as
 * "unknown", never as "forever".
 */
export const travelEventSchema = z
  .object({
    id: z.string().min(1),
    tripId: z.string().min(1),
    type: travelEventTypeSchema,
    severity: travelEventSeveritySchema.default("info"),
    occurredAt: z.string().min(10).max(40),
    effectiveFrom: z.string().min(10).max(40).optional(),
    effectiveUntil: z.string().min(10).max(40).optional(),
    source: travelEventSourceSchema.default("system"),
    sourceRef: z.string().max(200).optional(),
    provenance: travelEventProvenanceSchema,
    /** Free-form provider payload (delayMinutes, condition, closedReason...). */
    payload: z.record(z.string(), z.unknown()).default({}),
    relatedEntities: z.array(travelEventEntitySchema).max(20).default([]),
    /** Human-readable summary in the user's language (set at normalize time). */
    summary: z.string().max(300).optional(),
    acknowledgedAt: z.string().min(10).max(40).optional(),
  })
  .strict();

export type TravelEvent = z.output<typeof travelEventSchema>;

export const travelEventInputSchema = travelEventSchema
  .omit({ id: true, tripId: true, occurredAt: true, provenance: true })
  .partial({ severity: true, source: true, payload: true, relatedEntities: true })
  .extend({
    /** Provenance hints; the runtime stamps fetchedAt and builds provenance. */
    confidence: z.number().min(0).max(1).optional(),
    estimated: z.boolean().optional(),
  });

export type TravelEventInput = z.output<typeof travelEventInputSchema>;

/** Trips keep a bounded event log; the oldest facts fall off first. */
export const MAX_TRIP_EVENTS = 200;
