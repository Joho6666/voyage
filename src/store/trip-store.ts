import { create } from "zustand";
import { chongqingTrip } from "@/data/demo/chongqing";
import { tripRepository } from "@/services/trips/repository";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import type { Trip } from "@/types/travel";

interface TripState {
  trip: Trip;
  revision: number;
  saving: boolean;
  setTrip: (trip: Trip, revision?: number) => void;
  patchTrip: (updater: (trip: Trip) => Trip) => void;
  reorder: (dayId: string, orderedIds: string[]) => void;
  persist: () => Promise<void>;
}

export const useTripStore = create<TripState>((set, get) => ({
  trip: structuredClone(chongqingTrip),
  revision: 1,
  saving: false,
  setTrip: (trip, revision) => set((state) => ({ trip, revision: revision ?? state.revision + 1 })),
  patchTrip: (updater) => set({ trip: updater(get().trip) }),
  reorder: (dayId, orderedIds) => {
    const trip = get().trip;
    const items = trip.items.map((item) => {
      if (item.dayId !== dayId) return item;
      const order = orderedIds.indexOf(item.id);
      return order === -1 ? item : { ...item, order };
    });
    const estimated = recomputeDay({ ...trip, items }, dayId);
    set({ trip: estimated });
    void fetch("/api/voyage/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "reorder-day", input: { tripId: estimated.id, dayId, orderedItemIds: orderedIds, expectedTripRevision: get().revision } }) })
      .then((response) => response.json())
      .then((envelope: { ok?: boolean; data?: { trip?: Trip; revision?: number } }) => { if (envelope.data?.trip) set({ trip: envelope.data.trip, revision: envelope.data.revision ?? get().revision + 1 }); })
      .catch(() => undefined);
  },
  persist: async () => {
    set({ saving: true });
    const saved = await tripRepository.save(get().trip);
    set({ trip: saved, saving: false });
  },
}));

export function hydrateTrip(trip: Trip, revision = 1) {
  useTripStore.setState({ trip: recomputeTrip(trip), revision });
}
