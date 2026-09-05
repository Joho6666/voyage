"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { isAmapJsConfigured, loadAmapJs, type AMapInstance, type AMapOverlay } from "@/services/map/amap-js";
import type { Trip } from "@/types/travel";
import type { MapLayersConfig, MapMode, MapTheme } from "../models/map-state";
import { getBasemapConfig } from "../models/map-theme";
import { buildJourneyMarkers } from "../controllers/marker-controller";
import { buildJourneyRoutes } from "../controllers/route-controller";
import { MapOverlayRegistry } from "../controllers/overlay-controller";
import { MapCameraController } from "../controllers/camera-controller";
import { getMarkerHtml } from "./PlaceMarker";
import { getRouteBadgeHtml } from "./RouteBadge";
import { getUserLocationHtml } from "./UserLocationMarker";
import { MapToolbar } from "./MapToolbar";
import { DaySwitcher } from "./DaySwitcher";
import { MapPopover } from "./MapPopover";
import { NextStopBanner } from "./NextStopBanner";
import { JourneyOverview } from "./JourneyOverview";
import { JourneyScrubber } from "./JourneyScrubber";
import { JourneyMockMap } from "./JourneyMockMap";
import { useUiStore } from "@/store/ui-store";
import { useUserLocation } from "../hooks/useUserLocation";
import { useOfflineJourney } from "../hooks/useOfflineJourney";

export function JourneyAMapCanvas({
  trip,
  mode = "PLAN",
  theme = "light",
}: {
  trip: Trip;
  mode?: MapMode;
  theme?: MapTheme;
}) {
  const selectedPlaceId = useUiStore((s) => s.selectedPlaceId);
  const hoverPlaceId = useUiStore((s) => s.hoverPlaceId);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const hoverPlace = useUiStore((s) => s.hoverPlace);
  const setActiveDay = useUiStore((s) => s.setActiveDay);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const registry = useRef<MapOverlayRegistry>(new MapOverlayRegistry());
  const cameraController = useRef<MapCameraController>(new MapCameraController());
  const userLocationOverlay = useRef<AMapOverlay | null>(null);
  const initialTripRef = useRef(trip);
  const initialDayIdRef = useRef(activeDayId);

  const [failed, setFailed] = useState(!isAmapJsConfigured());
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(13);
  const [userInteracted, setUserInteracted] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [scrubberOpen, setScrubberOpen] = useState(false);
  const [layers, setLayers] = useState<MapLayersConfig>({
    trip: true,
    explore: mode === "EXPLORE",
    hotel: true,
    food: mode === "EXPLORE",
    transport: true,
  });

  const { location: userLocation, error: locationError, requestLocation } = useUserLocation();
  const { isOnline, isCached, isCaching, cacheTrip } = useOfflineJourney(trip);

  // Listen to camera controller userInteracted state
  useEffect(() => {
    return cameraController.current.subscribe(() => {
      setUserInteracted(cameraController.current.isUserInteracted());
    });
  }, []);

  // Initialize AMap Map Instance
  useEffect(() => {
    if (failed || !containerRef.current) return;
    let cancelled = false;

    void loadAmapJs()
      .then(() => {
        if (cancelled || !containerRef.current || !window.AMap) return;

        const basemap = getBasemapConfig(theme);
        const first = initialTripRef.current.places[0];

        const map = new window.AMap.Map(containerRef.current, {
          zoom: 13,
          center: first ? [first.lng, first.lat] : [106.55, 29.56],
          viewMode: "2D",
          mapStyle: basemap.mapStyle,
          features: basemap.features,
          showLabel: true,
          showIndoorMap: true,
        });

        mapRef.current = map;
        registry.current.setMap(map);
        cameraController.current.setMap(map);

        // Detect user interactions to prevent camera hijacking
        if (typeof map.on === "function") {
          map.on("dragstart", () => {
            cameraController.current.setUserInteracted(true);
          });
          map.on("zoomchange", () => {
            if (typeof map.getZoom === "function") {
              setZoom(map.getZoom());
            }
          });
        }

        // Initial camera bounds
        const initTrip = initialTripRef.current;
        const initDayId = initialDayIdRef.current;
        if (initDayId) {
          cameraController.current.fitDay(initTrip, initDayId, true);
        } else {
          cameraController.current.fitTrip(initTrip, true);
        }
      })
      .catch(() => setFailed(true));

    const reg = registry.current;
    return () => {
      cancelled = true;
      reg.clear();
      if (userLocationOverlay.current) {
        userLocationOverlay.current.setMap(null);
        userLocationOverlay.current = null;
      }
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [failed, theme]);

  // Build reactive models
  const markers = useMemo(() => {
    return buildJourneyMarkers(trip, {
      activeDayId,
      selectedPlaceId,
      hoverPlaceId,
      mapMode: mode,
      layers,
      zoom,
    });
  }, [trip, activeDayId, selectedPlaceId, hoverPlaceId, mode, layers, zoom]);

  const routes = useMemo(() => {
    return buildJourneyRoutes(trip, {
      activeDayId,
      selectedPlaceId,
      hoverPlaceId,
      selectedRouteId,
      mapMode: mode,
      zoom,
    });
  }, [trip, activeDayId, selectedPlaceId, hoverPlaceId, selectedRouteId, mode, zoom]);

  // Synchronize overlays via MapOverlayRegistry (diff-based updates, no destroy-all!)
  useEffect(() => {
    if (!mapRef.current) return;

    registry.current.syncMarkers(
      markers,
      {
        onSelectPlace: (placeId) => {
          selectPlace(placeId);
          setSelectedRouteId(null);
        },
        onHoverPlace: (placeId) => hoverPlace(placeId),
      },
      getMarkerHtml,
    );

    registry.current.syncRoutes(
      routes,
      {
        onSelectRoute: (segmentId) => {
          setSelectedRouteId(segmentId);
          selectPlace(null);
        },
      },
      (route) => (route.badge ? getRouteBadgeHtml(route.badge) : ""),
    );
  }, [markers, routes, selectPlace, hoverPlace]);

  // Synchronize User Location dot
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.AMap) return;

    if (userLocation) {
      if (!userLocationOverlay.current) {
        userLocationOverlay.current = new window.AMap.Marker({
          position: [userLocation.lng, userLocation.lat],
          content: getUserLocationHtml(),
          offset: new window.AMap.Pixel(-12, -12),
          zIndex: 100,
        });
        map.add(userLocationOverlay.current);
      } else {
        userLocationOverlay.current.setPosition?.([userLocation.lng, userLocation.lat]);
      }
    } else if (userLocationOverlay.current) {
      userLocationOverlay.current.setMap(null);
      userLocationOverlay.current = null;
    }
  }, [userLocation]);

  // Camera response to selected place or day changes
  useEffect(() => {
    if (selectedPlaceId && mapRef.current) {
      const p = trip.places.find((pl) => pl.id === selectedPlaceId);
      if (p) {
        cameraController.current.flyToPlace(p);
      }
    }
  }, [selectedPlaceId, trip.places]);

  if (failed) {
    return <JourneyMockMap trip={trip} mode={mode} />;
  }

  const selectedPlace = trip.places.find((p) => p.id === selectedPlaceId) ?? null;
  const selectedSegment = trip.segments.find((s) => s.id === selectedRouteId) ?? null;

  // Next stop calculation for Today mode
  const currentDayId = activeDayId ?? trip.days[0]?.id;
  const dayItems = trip.items.filter((i) => i.dayId === currentDayId).sort((a, b) => a.order - b.order);
  const currentIndex = dayItems.findIndex((i) => i.status !== "done");
  const currentItem = dayItems[currentIndex >= 0 ? currentIndex : 0];
  const nextItem = dayItems[currentIndex >= 0 ? currentIndex + 1 : 1];
  const currentPlace = trip.places.find((p) => p.id === currentItem?.placeId);
  const nextPlace = trip.places.find((p) => p.id === nextItem?.placeId) ?? currentPlace;
  const nextSegment = trip.segments.find((s) => s.fromItemId === currentItem?.id);

  const activeDay = trip.days.find((d) => d.id === activeDayId);

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden bg-[#f4f5f7] select-none">
      {/* AMap DOM Container */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Top Left Day Switcher */}
      <DaySwitcher
        days={trip.days}
        activeDayId={activeDayId}
        onSelectDay={(dayId) => {
          setActiveDay(dayId);
          if (dayId) {
            cameraController.current.fitDay(trip, dayId, true);
          } else {
            cameraController.current.fitTrip(trip, true);
          }
        }}
        onOpenOverview={() => setOverviewOpen(true)}
      />

      {/* Top Right Map Toolbar */}
      <MapToolbar
        onLocate={() => {
          requestLocation();
          if (userLocation) {
            cameraController.current.focusCurrentLocation(userLocation);
          }
        }}
        onFitDay={() => {
          if (activeDayId) {
            cameraController.current.fitDay(trip, activeDayId, true);
          } else {
            cameraController.current.fitTrip(trip, true);
          }
        }}
        onFitTrip={() => {
          setActiveDay(null);
          cameraController.current.fitTrip(trip, true);
        }}
        onZoomIn={() => {
          if (mapRef.current && typeof mapRef.current.setZoom === "function") {
            mapRef.current.setZoom(zoom + 1);
          }
        }}
        onZoomOut={() => {
          if (mapRef.current && typeof mapRef.current.setZoom === "function") {
            mapRef.current.setZoom(zoom - 1);
          }
        }}
        onRecenter={() => {
          cameraController.current.reset(trip, activeDayId);
        }}
        userInteracted={userInteracted}
        layers={layers}
        onToggleLayer={(k) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }))}
        activeDayTitle={activeDay ? `Day ${activeDay.index + 1}` : undefined}
        isOnline={isOnline}
        isCached={isCached}
        isCaching={isCaching}
        onCacheTrip={cacheTrip}
      />

      {/* Next Stop Banner in Today Mode */}
      {mode === "TODAY" ? (
        <NextStopBanner
          nextPlace={nextPlace}
          currentPlace={currentPlace}
          segment={nextSegment}
          locationError={locationError}
          onRequestLocation={requestLocation}
          onFocusNext={() => {
            if (nextPlace) {
              selectPlace(nextPlace.id);
              cameraController.current.flyToPlace(nextPlace);
            }
          }}
        />
      ) : null}

      {/* Selected Place or Route Popover */}
      {selectedPlace || selectedSegment ? (
        <MapPopover
          place={selectedPlace}
          segment={selectedSegment}
          trip={trip}
          onClose={() => {
            selectPlace(null);
            setSelectedRouteId(null);
          }}
        />
      ) : null}

      {/* Journey Overview Modal */}
      <JourneyOverview
        trip={trip}
        open={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        onSelectDay={(dayId) => {
          setActiveDay(dayId);
          if (dayId) {
            cameraController.current.fitDay(trip, dayId, true);
          } else {
            cameraController.current.fitTrip(trip, true);
          }
        }}
      />

      {/* Journey Scrubber (Simulation) */}
      {scrubberOpen ? (
        <JourneyScrubber
          trip={trip}
          activeDayId={activeDayId}
          onSimulate={({ placeId, routeId }) => {
            if (placeId) selectPlace(placeId);
            if (routeId) setSelectedRouteId(routeId);
          }}
          onClose={() => setScrubberOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setScrubberOpen(true)}
          className="absolute bottom-4 right-4 z-20 rounded-full border border-border/80 bg-surface/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-xs hover:text-foreground hover:bg-secondary transition-colors"
        >
          ⏱ 行程预演
        </button>
      )}
    </div>
  );
}
