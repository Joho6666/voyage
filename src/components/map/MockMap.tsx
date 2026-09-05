"use client";

import { JourneyMockMap } from "@/features/journey-map/components/JourneyMockMap";
import { useTripStore } from "@/store/trip-store";
import type { MapMode } from "@/features/journey-map/models/map-state";

export function MockMap({ mode = "PLAN" }: { mode?: MapMode }) {
  const trip = useTripStore((s) => s.trip);
  return <JourneyMockMap trip={trip} mode={mode} />;
}
