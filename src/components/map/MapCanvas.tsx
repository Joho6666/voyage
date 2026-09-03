"use client";

import dynamic from "next/dynamic";
import { isAmapJsConfigured } from "@/services/map/amap-js";
import { MockMap } from "./MockMap";

const AMapCanvas = dynamic(() => import("./AMapCanvas").then((m) => m.AMapCanvas), {
  ssr: false,
  loading: () => <MockMap />,
});

export function MapCanvas() {
  if (!isAmapJsConfigured()) return <MockMap />;
  return <AMapCanvas />;
}
