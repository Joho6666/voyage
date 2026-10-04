import { z } from "zod";

/**
 * Travel Brain v4 contracts (Phase 4.1).
 *
 * These schemas are the single source of truth for brain-side intelligence
 * metadata: what the RouteMatrix records about each edge, what the
 * ConstraintEngine reports, and what createTrip persists under
 * planningMetadata.brain. Everything here is optional and additive — trips
 * created with VOYAGE_BRAIN off must validate exactly as before.
 */

export const factLevelSchema = z.enum(["REAL", "CACHED", "ESTIMATED", "SOCIAL", "CURATED"]);
export type FactLevel = z.output<typeof factLevelSchema>;

/** One ordered pair in the partial route matrix. */
export const routeMatrixEdgeSchema = z.object({
  fromPlaceId: z.string().min(1),
  toPlaceId: z.string().min(1),
  /** Straight-line distance, always present; the initial-filter signal. */
  haversineMeters: z.number().min(0),
  /** Best-known minutes for the pair (real measurement or estimate). */
  durationMinutes: z.number().min(0),
  mode: z.enum(["walk", "metro", "bus", "taxi", "drive"]),
  /** Whether a realtime provider was queried for this edge. */
  queried: z.boolean(),
  level: factLevelSchema,
  /** Average CNY cost for the pair across the configured travelers. */
  costCny: z.number().min(0),
});
export type RouteMatrixEdge = z.output<typeof routeMatrixEdgeSchema>;

export const routeMatrixSchema = z.object({
  city: z.string().min(1),
  mode: z.enum(["walk", "metro", "bus", "taxi", "drive"]),
  edges: z.array(routeMatrixEdgeSchema),
  builtAt: z.string().min(1),
  /** queried edges / selected edges — how much of the matrix is measured. */
  coverage: z.number().min(0).max(1),
});
export type RouteMatrix = z.output<typeof routeMatrixSchema>;

export const constraintViolationSchema = z.object({
  constraintId: z.string().min(1),
  detail: z.string().min(1),
  severity: z.enum(["error", "warn"]),
});
export type ConstraintViolation = z.output<typeof constraintViolationSchema>;

export const softPenaltySchema = z.object({
  constraintId: z.string().min(1),
  penalty: z.number().min(0).max(100),
  detail: z.string().min(1),
});
export type SoftPenalty = z.output<typeof softPenaltySchema>;

export const repairHintSchema = z.object({
  kind: z.enum(["reorder", "swapMode", "replacePlace", "shiftTime", "dropStop", "insertPlace", "padDays"]),
  target: z.string().min(1),
  reason: z.string().min(1),
});
export type RepairHint = z.output<typeof repairHintSchema>;

export const constraintEvaluationSchema = z.object({
  hardViolations: z.array(constraintViolationSchema),
  softPenalties: z.array(softPenaltySchema),
  score: z.number().min(0).max(100),
  warnings: z.array(z.string()),
  repairHints: z.array(repairHintSchema),
});
export type ConstraintEvaluation = z.output<typeof constraintEvaluationSchema>;

/** What createTrip persists under planningMetadata.brain when VOYAGE_BRAIN=1. */
export const brainMetadataSchema = z.object({
  version: z.literal("4.1"),
  routeMatrix: z.object({
    realEdges: z.number().int().min(0),
    estimatedEdges: z.number().int().min(0),
    coverage: z.number().min(0).max(1),
  }),
  constraintEvaluation: constraintEvaluationSchema,
  repairs: z.array(z.string()),
});
export type BrainMetadata = z.output<typeof brainMetadataSchema>;
