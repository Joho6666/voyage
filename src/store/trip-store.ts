import { create } from "zustand";
import { chongqingTrip } from "@/data/demo/chongqing";
import { tripRepository } from "@/services/trips/repository";
import { recomputeDay, recomputeDayWithRealRoutes, recomputeTrip } from "@/services/routing";
import type { Trip } from "@/types/travel";

interface TripState {
  trip: Trip;
  saving: boolean;
  setTrip: (trip: Trip) => void;
  patchTrip: (updater: (trip: Trip) => Trip) => void;
  reorder: (dayId: string, orderedIds: string[]) => void;
  persist: () => Promise<void>;
}

export const useTripStore = create<TripState>((set, get) => ({
  trip: structuredClone(chongqingTrip),
  saving: false,
  setTrip: (trip) => set({ trip }),
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
    void recomputeDayWithRealRoutes(estimated, dayId).then(async (routed) => {
      set({ trip: routed });
      await tripRepository.save(routed);
    });
  },
  persist: async () => {
    set({ saving: true });
    const saved = await tripRepository.save(get().trip);
    set({ trip: saved, saving: false });
  },
}));

export function hydrateTrip(trip: Trip) {
  useTripStore.setState({ trip: recomputeTrip(trip) });
}
