import type { ItemStatus, Place, TaskStatus, Trip } from "@/types/travel";
import { ApiError, runCommand } from "@/lib/api-client";

export interface AddPlaceResult {
  trip: Trip;
  revision: number;
}

/** Trip-write failures keep their server error code (REVISION_CONFLICT etc.). */
export class TripCommandError extends ApiError {}

interface TripCommandData {
  trip?: Trip;
  revision?: number;
  importedCount?: number;
}

async function mutateTrip(command: string, input: Record<string, unknown>, messages: { network: string; fallback: string }): Promise<AddPlaceResult & { importedCount?: number }> {
  const data = await runCommand<TripCommandData>(command, input, { networkMessage: messages.network, fallbackMessage: messages.fallback });
  if (!data.trip) throw new TripCommandError(messages.fallback);
  return {
    trip: data.trip,
    revision: data.revision ?? (input.expectedTripRevision as number) + 1,
    ...(data.importedCount !== undefined ? { importedCount: data.importedCount } : {}),
  };
}

/**
 * Adds a provider place to a day through the real runtime. Unlike the old
 * mock-agent path, the server validates provider provenance, appends the item
 * under a revision lock, recomputes the day, and returns the persisted trip —
 * so the addition survives a reload.
 */
export function addPlaceItemToDay(input: { tripId: string; place: Place; dayId: string; expectedTripRevision: number }) {
  return mutateTrip("add-place-item", { tripId: input.tripId, dayId: input.dayId, place: input.place, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，加入行程失败，请重试", fallback: "加入行程失败，请重试" });
}

/**
 * Restores a trip snapshot on the server (undo/redo, and the local proposal
 * apply path). The previous implementation only patched the client store and
 * bumped the revision optimistically — the change vanished on reload and the
 * next write collided with a revision the server had never issued.
 */
export function restoreTrip(input: { tripId: string; trip: Trip; expectedTripRevision: number }) {
  return mutateTrip("restore-trip", { tripId: input.tripId, trip: input.trip, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，恢复行程失败，请重试", fallback: "恢复行程失败，请重试" });
}

/**
 * Bookmarks a place onto the trip map without scheduling it. The map-mark
 * buttons used to patch only the local store, so marks vanished on reload.
 */
export function addPlaceToTrip(input: { tripId: string; place: Place; expectedTripRevision: number }) {
  return mutateTrip("add-place", { tripId: input.tripId, place: input.place, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，地图标记保存失败，请重试", fallback: "地图标记保存失败，请重试" });
}

/**
 * Persists an item status change (e.g. checking a stop off on the today
 * screen). The local-only path lost every check-off on reload because the
 * workspace rehydrates from the server-side runtime.
 */
export function setItemStatus(input: { tripId: string; itemId: string; status: ItemStatus; expectedTripRevision: number }) {
  return mutateTrip("set-item-status", { tripId: input.tripId, itemId: input.itemId, status: input.status, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，状态保存失败，请重试", fallback: "状态保存失败，请重试" });
}

/**
 * Removes a stop from its day through the runtime. The PoiCard overflow menu
 * used to patch the local store only — the removal vanished on the next
 * server rehydrate and was invisible to other tabs and the assistant.
 */
export function removeItemFromTrip(input: { tripId: string; itemId: string; expectedTripRevision: number }) {
  return mutateTrip("remove-item", { tripId: input.tripId, itemId: input.itemId, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，移除行程失败，请重试", fallback: "移除行程失败，请重试" });
}

/**
 * Removes an entire day through the runtime. The DayHeader menu used to have
 * no such capability at all — deleting a day meant regenerating the trip.
 */
export function removeDayFromTrip(input: { tripId: string; dayId: string; expectedTripRevision: number }) {
  return mutateTrip("remove-day", { tripId: input.tripId, dayId: input.dayId, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，删除行程天失败，请重试", fallback: "删除行程天失败，请重试" });
}

/**
 * One-click guide import: ordered places are spread across trip days in a
 * single server transaction, each stop getting a check-in task. Replaces the
 * old per-place loop that could leave half-imported routes on failure.
 */
export function importRouteToTrip(input: { tripId: string; assignments: Array<{ dayId: string; places: Place[] }>; createTasks?: boolean; expectedTripRevision: number }) {
  return mutateTrip("import-route", { tripId: input.tripId, assignments: input.assignments, createTasks: input.createTasks ?? true, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，路线导入失败，请重试", fallback: "路线导入失败，请重试" });
}

/** Persists a task checkbox (the inline list used to patch local state only). */
export function setTaskStatus(input: { tripId: string; taskId: string; status: TaskStatus; expectedTripRevision: number }) {
  return mutateTrip("set-task-status", { tripId: input.tripId, taskId: input.taskId, status: input.status, expectedTripRevision: input.expectedTripRevision }, { network: "网络异常，任务状态保存失败，请重试", fallback: "任务状态保存失败，请重试" });
}
