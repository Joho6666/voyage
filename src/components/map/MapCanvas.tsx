"use client";

import { JourneyMap } from "@/features/journey-map/JourneyMap";
import type { MapMode, MapTheme } from "@/features/journey-map/models/map-state";

export function MapCanvas({
  mode = "PLAN",
  theme = "light",
}: {
  mode?: MapMode;
  theme?: MapTheme;
}) {
  return <JourneyMap mode={mode} theme={theme} />;
}
