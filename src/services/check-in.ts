import { toast } from "sonner";
import { setItemStatus, TripCommandError } from "@/services/trip-commands";
import { resyncTrip, useTripStore } from "@/store/trip-store";
import type { ItemStatus } from "@/types/travel";

/**
 * Check a stop off (or back on) with one shared implementation: optimistic
 * flip, revision-locked runtime write, rollback on failure, and an automatic
 * resync on REVISION_CONFLICT so a stale client never blocks later writes.
 * The today list and the map popover both go through this — a second diverging
 * copy is how the local-only check-off bug happened in the first place.
 */
export function toggleItemDone(itemId: string) {
  const store = useTripStore.getState();
  const current = store.trip.items.find((candidate) => candidate.id === itemId)?.status;
  const nextStatus: ItemStatus = current === "done" ? "planned" : "done";
  store.patchTrip((trip) => ({
    ...trip,
    items: trip.items.map((candidate) =>
      candidate.id === itemId ? { ...candidate, status: nextStatus } : candidate,
    ),
  }));
  void setItemStatus({ tripId: store.trip.id, itemId, status: nextStatus, expectedTripRevision: store.revision })
    .then(({ trip, revision }) => useTripStore.getState().setTrip(trip, revision))
    .catch((cause) => {
      useTripStore.getState().setTrip(store.trip, store.revision);
      if (cause instanceof TripCommandError && cause.code === "REVISION_CONFLICT") {
        toast.error("行程已在别处更新，已同步最新版本，请重试");
        void resyncTrip(store.trip.id);
        return;
      }
      toast.error(cause instanceof TripCommandError ? cause.message : "状态保存失败，请重试");
    });
}
