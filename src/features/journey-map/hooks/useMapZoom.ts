"use client";

import { useCallback, useState } from "react";
import { getZoomDensityTier, type ZoomDensityTier } from "../models/map-state";

export function useMapZoom(initialZoom: number = 13) {
  const [zoom, setZoomState] = useState(initialZoom);
  const tier: ZoomDensityTier = getZoomDensityTier(zoom);

  const setZoom = useCallback((newZoom: number) => {
    setZoomState(Number(newZoom.toFixed(1)));
  }, []);

  return {
    zoom,
    tier,
    setZoom,
  };
}
