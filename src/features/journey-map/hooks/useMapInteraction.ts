"use client";

import { useCallback, useState } from "react";
import { useUiStore } from "@/store/ui-store";

export function useMapInteraction() {
  const selectedPlaceId = useUiStore((s) => s.selectedPlaceId);
  const hoverPlaceId = useUiStore((s) => s.hoverPlaceId);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const hoverPlace = useUiStore((s) => s.hoverPlace);
  const setActiveDay = useUiStore((s) => s.setActiveDay);

  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const handleSelectPlace = useCallback(
    (placeId: string | null) => {
      selectPlace(placeId);
      if (placeId) setSelectedRouteId(null);
    },
    [selectPlace],
  );

  const handleSelectRoute = useCallback(
    (routeId: string | null) => {
      setSelectedRouteId(routeId);
      if (routeId) selectPlace(null);
    },
    [selectPlace],
  );

  return {
    selectedPlaceId,
    hoverPlaceId,
    activeDayId,
    selectedRouteId,
    selectPlace: handleSelectPlace,
    hoverPlace,
    setActiveDay,
    selectRoute: handleSelectRoute,
  };
}
