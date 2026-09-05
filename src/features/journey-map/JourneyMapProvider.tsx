"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Trip } from "@/types/travel";
import {
  DEFAULT_LAYERS,
  type MapLayersConfig,
  type MapMode,
  type MapTheme,
  type UserLocation,
  type ZoomDensityTier,
} from "./models/map-state";
import { useMapCamera } from "./hooks/useMapCamera";
import { useUserLocation } from "./hooks/useUserLocation";
import { useMapZoom } from "./hooks/useMapZoom";
import { useUiStore } from "@/store/ui-store";

interface JourneyMapContextValue {
  trip: Trip;
  mode: MapMode;
  theme: MapTheme;
  activeDayId: string | null;
  selectedPlaceId: string | null;
  hoverPlaceId: string | null;
  selectedRouteId: string | null;
  layers: MapLayersConfig;
  zoom: number;
  tier: ZoomDensityTier;
  userLocation: UserLocation | null;
  locationError: string | null;
  userInteracted: boolean;
  camera: ReturnType<typeof useMapCamera>;
  selectPlace: (placeId: string | null) => void;
  hoverPlace: (placeId: string | null) => void;
  selectRoute: (routeId: string | null) => void;
  setActiveDay: (dayId: string | null) => void;
  toggleLayer: (layer: keyof MapLayersConfig) => void;
  setZoom: (zoom: number) => void;
  requestLocation: () => void;
  recenter: () => void;
}

const JourneyMapContext = createContext<JourneyMapContextValue | null>(null);

export function JourneyMapProvider({
  trip,
  mode = "PLAN",
  theme = "light",
  children,
}: {
  trip: Trip;
  mode?: MapMode;
  theme?: MapTheme;
  children: React.ReactNode;
}) {
  const selectedPlaceId = useUiStore((s) => s.selectedPlaceId);
  const hoverPlaceId = useUiStore((s) => s.hoverPlaceId);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const selectPlaceInStore = useUiStore((s) => s.selectPlace);
  const hoverPlaceInStore = useUiStore((s) => s.hoverPlace);
  const setActiveDayInStore = useUiStore((s) => s.setActiveDay);

  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayersConfig>(DEFAULT_LAYERS[mode]);

  const camera = useMapCamera();
  const { location: userLocation, error: locationError, requestLocation } = useUserLocation();
  const { zoom, tier, setZoom } = useMapZoom(13);

  const selectPlace = useCallback(
    (placeId: string | null) => {
      selectPlaceInStore(placeId);
      if (placeId) {
        setSelectedRouteId(null);
        const place = trip.places.find((p) => p.id === placeId);
        if (place) {
          camera.flyToPlace(place);
        }
      }
    },
    [camera, selectPlaceInStore, trip.places],
  );

  const selectRoute = useCallback(
    (routeId: string | null) => {
      setSelectedRouteId(routeId);
      if (routeId) {
        selectPlaceInStore(null);
        const seg = trip.segments.find((s) => s.id === routeId);
        if (seg) {
          const fromPlace = trip.places.find((p) => p.id === seg.fromPlaceId);
          const toPlace = trip.places.find((p) => p.id === seg.toPlaceId);
          if (fromPlace && toPlace) {
            camera.focusRoute([
              { lat: fromPlace.lat, lng: fromPlace.lng },
              { lat: toPlace.lat, lng: toPlace.lng },
            ]);
          }
        }
      }
    },
    [camera, selectPlaceInStore, trip.places, trip.segments],
  );

  const setActiveDay = useCallback(
    (dayId: string | null) => {
      setActiveDayInStore(dayId);
      if (dayId) {
        camera.fitDay(trip, dayId, true);
      } else {
        camera.fitTrip(trip, true);
      }
    },
    [camera, setActiveDayInStore, trip],
  );

  const toggleLayer = useCallback((key: keyof MapLayersConfig) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const recenter = useCallback(() => {
    camera.reset(trip, activeDayId);
  }, [activeDayId, camera, trip]);

  const value = useMemo<JourneyMapContextValue>(
    () => ({
      trip,
      mode,
      theme,
      activeDayId,
      selectedPlaceId,
      hoverPlaceId,
      selectedRouteId,
      layers,
      zoom,
      tier,
      userLocation,
      locationError,
      userInteracted: camera.userInteracted,
      camera,
      selectPlace,
      hoverPlace: hoverPlaceInStore,
      selectRoute,
      setActiveDay,
      toggleLayer,
      setZoom,
      requestLocation,
      recenter,
    }),
    [
      trip,
      mode,
      theme,
      activeDayId,
      selectedPlaceId,
      hoverPlaceId,
      selectedRouteId,
      layers,
      zoom,
      tier,
      userLocation,
      locationError,
      camera,
      selectPlace,
      hoverPlaceInStore,
      selectRoute,
      setActiveDay,
      toggleLayer,
      setZoom,
      requestLocation,
      recenter,
    ],
  );

  return <JourneyMapContext.Provider value={value}>{children}</JourneyMapContext.Provider>;
}

export function useJourneyMap() {
  const ctx = useContext(JourneyMapContext);
  if (!ctx) {
    throw new Error("useJourneyMap must be used within JourneyMapProvider");
  }
  return ctx;
}
