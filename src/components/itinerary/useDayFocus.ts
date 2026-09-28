"use client";

import { useEffect } from "react";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";

/**
 * Keeps the day focus tied to the loaded trip: focus today when the trip covers
 * it, otherwise the first day. The traveller's own choice (including "全部") is
 * preserved while they stay on the same trip.
 */
export function useDayFocus() {
  const tripId = useTripStore((s) => s.trip.id);
  const days = useTripStore((s) => s.trip.days);
  const focusDefaultDay = useUiStore((s) => s.focusDefaultDay);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const setActiveDay = useUiStore((s) => s.setActiveDay);

  useEffect(() => {
    if (!tripId || !days.length) return;
    focusDefaultDay(tripId, days.map((day) => ({ id: day.id, date: day.date })));
  }, [tripId, days, focusDefaultDay]);

  // A stored focus that no longer exists (trip swapped, day removed) must not
  // leave the itinerary column blank.
  useEffect(() => {
    if (activeDayId && days.length && !days.some((day) => day.id === activeDayId)) {
      setActiveDay(days[0].id);
    }
  }, [activeDayId, days, setActiveDay]);

  return activeDayId;
}
