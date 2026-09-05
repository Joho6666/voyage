"use client";

import { useEffect, useMemo, useState } from "react";
import { MapCameraController } from "../controllers/camera-controller";
import type { Place, Trip } from "@/types/travel";
import type { UserLocation } from "../models/map-state";

export function useMapCamera() {
  const controller = useMemo(() => new MapCameraController(), []);
  const [userInteracted, setUserInteracted] = useState(false);

  useEffect(() => {
    return controller.subscribe(() => {
      setUserInteracted(controller.isUserInteracted());
    });
  }, [controller]);

  return {
    controller,
    userInteracted,
    fitTrip: (trip: Trip, force?: boolean) => controller.fitTrip(trip, force),
    fitDay: (trip: Trip, dayId: string, force?: boolean) => controller.fitDay(trip, dayId, force),
    flyToPlace: (place: Place) => controller.flyToPlace(place),
    focusRoute: (path: Array<{ lat: number; lng: number }>) => controller.focusRoute(path),
    focusCurrentLocation: (loc: UserLocation) => controller.focusCurrentLocation(loc),
    reset: (trip: Trip, activeDayId: string | null) => controller.reset(trip, activeDayId),
  };
}
