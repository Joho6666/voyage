import type { ItemStatus, Place, Trip } from "@/types/travel";

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

/**
 * Bookmarks a place onto the trip map without scheduling it. The map-mark
 * buttons used to patch only the local store, so marks vanished on reload.
 */
export async function addPlaceToTrip(input: {
  tripId: string;
  place: Place;
  expectedTripRevision: number;
}): Promise<AddPlaceResult> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "add-place",
        input: { tripId: input.tripId, place: input.place, expectedTripRevision: input.expectedTripRevision },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，地图标记保存失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "地图标记保存失败，请重试", envelope.error?.code);
  }
  return { trip: envelope.data.trip, revision: envelope.data.revision ?? input.expectedTripRevision + 1 };
}

/**
 * Persists an item status change (e.g. checking a stop off on the today
 * screen). The local-only path lost every check-off on reload because the
 * workspace rehydrates from the server-side runtime.
 */
export async function setItemStatus(input: {
  tripId: string;
  itemId: string;
  status: ItemStatus;
  expectedTripRevision: number;
}): Promise<AddPlaceResult> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "set-item-status",
        input: {
          tripId: input.tripId,
          itemId: input.itemId,
          status: input.status,
          expectedTripRevision: input.expectedTripRevision,
        },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，状态保存失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "状态保存失败，请重试", envelope.error?.code);
  }
  return { trip: envelope.data.trip, revision: envelope.data.revision ?? input.expectedTripRevision + 1 };
}
