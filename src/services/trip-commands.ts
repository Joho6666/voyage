import type { Place, Trip } from "@/types/travel";

export interface AddPlaceResult {
  trip: Trip;
  revision: number;
}

export class TripCommandError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "TripCommandError";
  }
}

/**
 * Adds a provider place to a day through the real runtime. Unlike the old
 * mock-agent path, the server validates provider provenance, appends the item
 * under a revision lock, recomputes the day, and returns the persisted trip —
 * so the addition survives a reload.
 */
export async function addPlaceItemToDay(input: {
  tripId: string;
  place: Place;
  dayId: string;
  expectedTripRevision: number;
}): Promise<AddPlaceResult> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "add-place-item",
        input: {
          tripId: input.tripId,
          dayId: input.dayId,
          place: input.place,
          expectedTripRevision: input.expectedTripRevision,
        },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，加入行程失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "加入行程失败，请重试", envelope.error?.code);
  }
  return { trip: envelope.data.trip, revision: envelope.data.revision ?? input.expectedTripRevision + 1 };
}
