"use client";

import dynamic from "next/dynamic";
import { isAmapJsConfigured } from "@/services/map/amap-js";
import { JourneyMockMap } from "./components/JourneyMockMap";
import { useTripStore } from "@/store/trip-store";
import type { MapMode, MapTheme } from "./models/map-state";

const JourneyAMapCanvas = dynamic(
  () => import("./components/JourneyAMapCanvas").then((m) => m.JourneyAMapCanvas),
  {
    ssr: false,
    loading: () => <JourneyMockMapPlaceholder />,
  },
);

function JourneyMockMapPlaceholder() {
  const trip = useTripStore((s) => s.trip);
  return <JourneyMockMap trip={trip} mode="PLAN" />;
}

export function JourneyMap({
  mode = "PLAN",
  theme = "light",
}: {
  mode?: MapMode;
  theme?: MapTheme;
}) {
  const trip = useTripStore((s) => s.trip);

  if (!isAmapJsConfigured()) {
    return <JourneyMockMap trip={trip} mode={mode} fallbackReason="NEXT_PUBLIC_AMAP_KEY 未配置" />;
  }

  return <JourneyAMapCanvas trip={trip} mode={mode} theme={theme} />;
}
