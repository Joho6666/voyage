import type { ItemStatus, Place, TaskStatus, Trip } from "@/types/travel";

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
 * Restores a trip snapshot on the server (undo/redo, and the local proposal
 * apply path). The previous implementation only patched the client store and
 * bumped the revision optimistically — the change vanished on reload and the
 * next write collided with a revision the server had never issued.
 */
export async function restoreTrip(input: {
  tripId: string;
  trip: Trip;
  expectedTripRevision: number;
}): Promise<AddPlaceResult> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "restore-trip",
        input: { tripId: input.tripId, trip: input.trip, expectedTripRevision: input.expectedTripRevision },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，恢复行程失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "恢复行程失败，请重试", envelope.error?.code);
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

/**
 * Removes a stop from its day through the runtime. The PoiCard overflow menu
 * used to patch the local store only — the removal vanished on the next
 * server rehydrate and was invisible to other tabs and the assistant.
 */
export async function removeItemFromTrip(input: {
  tripId: string;
  itemId: string;
  expectedTripRevision: number;
}): Promise<AddPlaceResult> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "remove-item",
        input: { tripId: input.tripId, itemId: input.itemId, expectedTripRevision: input.expectedTripRevision },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，移除行程失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "移除行程失败，请重试", envelope.error?.code);
  }
  return { trip: envelope.data.trip, revision: envelope.data.revision ?? input.expectedTripRevision + 1 };
}

/**
 * One-click guide import: ordered places are spread across trip days in a
 * single server transaction, each stop getting a check-in task. Replaces the
 * old per-place loop that could leave half-imported routes on failure.
 */
export async function importRouteToTrip(input: {
  tripId: string;
  assignments: Array<{ dayId: string; places: Place[] }>;
  createTasks?: boolean;
  expectedTripRevision: number;
}): Promise<AddPlaceResult & { importedCount: number }> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number; importedCount?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "import-route",
        input: {
          tripId: input.tripId,
          assignments: input.assignments,
          createTasks: input.createTasks ?? true,
          expectedTripRevision: input.expectedTripRevision,
        },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，路线导入失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "路线导入失败，请重试", envelope.error?.code);
  }
  return {
    trip: envelope.data.trip,
    revision: envelope.data.revision ?? input.expectedTripRevision + 1,
    importedCount: envelope.data.importedCount ?? 0,
  };
}

/** Persists a task checkbox (the inline list used to patch local state only). */
export async function setTaskStatus(input: {
  tripId: string;
  taskId: string;
  status: TaskStatus;
  expectedTripRevision: number;
}): Promise<AddPlaceResult> {
  let envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number }; error?: { code?: string; message?: string } };
  try {
    const response = await fetch("/api/voyage/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "set-task-status",
        input: {
          tripId: input.tripId,
          taskId: input.taskId,
          status: input.status,
          expectedTripRevision: input.expectedTripRevision,
        },
      }),
    });
    envelope = await response.json();
  } catch {
    throw new TripCommandError("网络异常，任务状态保存失败，请重试");
  }
  if (!envelope.ok || !envelope.data?.trip) {
    throw new TripCommandError(envelope.error?.message ?? "任务状态保存失败，请重试", envelope.error?.code);
  }
  return { trip: envelope.data.trip, revision: envelope.data.revision ?? input.expectedTripRevision + 1 };
}
