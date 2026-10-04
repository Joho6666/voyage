import { z } from "zod";

/**
 * Reservation domain (Phase 6.1).
 *
 * A Reservation is a real-world commitment — a flight seat, a train ticket, a
 * hotel night, a restaurant table, an attraction slot — that the itinerary
 * must respect. Confirmed reservations become HARD constraints for the
 * constraint engine (see src/services/brain/constraints.ts): the optimizer and
 * every replan path must schedule around them, never through them.
 *
 * Reservations live on the Trip (payload jsonb) like offers and social
 * evidence: no dedicated table yet, zero-migration rollout. The id and tripId
 * are assigned by the runtime, never trusted from input.
 */

export const reservationTypeSchema = z.enum([
  "flight",
  "train",
  "hotel",
  "restaurant",
  "attraction",
  "activity",
  "car",
  "transfer",
  "other",
]);

export const reservationStatusSchema = z.enum(["tentative", "confirmed", "cancelled", "completed"]);

/** fixed: time is immovable; semiFlexible: ±window negotiable; flexible: movable. */
export const reservationFlexibilitySchema = z.enum(["fixed", "semiFlexible", "flexible"]);

const isoDateTime = z.string().min(10).max(40);

export const reservationProvenanceSchema = z.object({
  /** user: typed in by the traveller; import: pasted confirmation; provider: fetched. */
  source: z.enum(["user", "import", "provider"]),
  vendor: z.string().max(40).optional(),
  fetchedAt: isoDateTime,
  /** Price/time not verified against a live provider. */
  estimated: z.boolean().default(false),
});

export const reservationSchema = z
  .object({
    id: z.string().min(1),
    tripId: z.string().min(1),
    type: reservationTypeSchema,
    status: reservationStatusSchema.default("tentative"),
    title: z.string().min(1).max(120),
    startAt: isoDateTime,
    endAt: isoDateTime.optional(),
    origin: z.string().max(80).optional(),
    destination: z.string().max(80).optional(),
    location: z.string().max(160).optional(),
    provider: z.string().max(40).optional(),
    confirmationCode: z.string().max(60).optional(),
    price: z.number().min(0).optional(),
    currency: z.string().length(3).default("CNY"),
    cancellationPolicy: z.string().max(240).optional(),
    flexibility: reservationFlexibilitySchema.default("fixed"),
    /** Itinerary item this reservation is anchored to (ItineraryItem.reservationId). */
    linkedItemId: z.string().optional(),
    notes: z.string().max(600).optional(),
    provenance: reservationProvenanceSchema,
  })
  .strict();

export type Reservation = z.output<typeof reservationSchema>;
export type ReservationType = z.output<typeof reservationTypeSchema>;
export type ReservationStatus = z.output<typeof reservationStatusSchema>;
export type ReservationInput = z.input<typeof reservationSchema>;

/** Everything except id/tripId/provenance is caller-supplied. */
export const reservationInputSchema = reservationSchema
  .omit({ id: true, tripId: true, provenance: true })
  .partial({ status: true, currency: true, flexibility: true });
export type ReservationInputFields = z.output<typeof reservationInputSchema>;

/** Bulk import (pasted confirmations): provenance is derived from the request. */
export const reservationImportItemSchema = reservationInputSchema.extend({
  confirmationCode: z.string().max(60).optional(),
});
export type ReservationImportItem = z.output<typeof reservationImportItemSchema>;
