import { z } from "zod";

/**
 * TripState contract (Phase 6.4).
 *
 * TripState is the deterministic answer to "where is this traveller right
 * now and what does the road ahead look like". It is computed by
 * src/services/trip-state/engine.ts — a pure function, no LLM, no providers —
 * and consumed by the Today console, the Impact Engine and the agent tools.
 *
 * All wall-clock fields are Asia/Shanghai, matching the trip's date semantics.
 */

export const tripPhaseSchema = z.enum(["before", "during", "after"]);
export const riskLevelSchema = z.enum(["low", "medium", "high"]);

export const tripStateItemSchema = z.object({
  itemId: z.string(),
  dayId: z.string(),
  date: z.string(),
  placeId: z.string(),
  placeName: z.string(),
  type: z.string(),
  startTime: z.string(),
  duration: z.number(),
  status: z.string(),
}).strict();

export const tripStateReservationSchema = z.object({
  reservationId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string().optional(),
  location: z.string().optional(),
  confirmationCode: z.string().optional(),
}).strict();

export const tripStateSchema = z.object({
  tripId: z.string(),
  asOf: z.string(),
  computedAt: z.string(),
  /** asOf is far from the trip's last update — the snapshot may be outdated. */
  stale: z.boolean(),
  phase: tripPhaseSchema,
  currentDay: z.object({ dayId: z.string(), date: z.string(), index: z.number() }).strict().nullable(),
  currentItem: tripStateItemSchema.nullable(),
  nextItem: tripStateItemSchema.nullable(),
  completedCount: z.number(),
  remainingItems: z.array(tripStateItemSchema),
  activeReservations: z.array(tripStateReservationSchema),
  upcomingHardConstraints: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    startAt: z.string(),
    endAt: z.string().optional(),
  }).strict()),
  currentWeather: z.object({
    date: z.string(),
    condition: z.string(),
    tempC: z.number(),
    icon: z.string(),
  }).strict().nullable(),
  activeEvents: z.array(z.object({
    id: z.string(),
    type: z.string(),
    severity: z.string(),
    summary: z.string().optional(),
    effectiveFrom: z.string().optional(),
    effectiveUntil: z.string().optional(),
  }).strict()),
  lateByMinutes: z.number().nullable(),
  aheadByMinutes: z.number().nullable(),
  remainingWalkingMeters: z.number(),
  remainingTravelMinutes: z.number(),
  estimatedFinishTime: z.string().nullable(),
  budgetState: z.object({
    budget: z.number(),
    estimatedSpend: z.number(),
    remaining: z.number(),
  }).strict(),
  riskLevel: riskLevelSchema,
  constraintViolations: z.array(z.string()),
  suggestedActions: z.array(z.string()),
});

export type TripState = z.output<typeof tripStateSchema>;
export type TripPhase = z.output<typeof tripPhaseSchema>;
export type RiskLevel = z.output<typeof riskLevelSchema>;
