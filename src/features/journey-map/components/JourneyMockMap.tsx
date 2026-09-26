"use client";

import React, { useMemo, useState } from "react";
import { project } from "@/lib/map-project";
import type { Trip } from "@/types/travel";
import type { MapLayersConfig, MapMode } from "../models/map-state";
import { buildJourneyMarkers } from "../controllers/marker-controller";
import { buildJourneyRoutes } from "../controllers/route-controller";
import { PlaceMarker } from "./PlaceMarker";
import { RouteBadgeComponent } from "./RouteBadge";
import { UserLocationMarker } from "./UserLocationMarker";
import { MapToolbar } from "./MapToolbar";
import { DaySwitcher } from "./DaySwitcher";
import { MapPopover } from "./MapPopover";
import { NextStopBanner } from "./NextStopBanner";
import { JourneyOverview } from "./JourneyOverview";
import { JourneyScrubber } from "./JourneyScrubber";
import { useUiStore } from "@/store/ui-store";
import { useUserLocation } from "../hooks/useUserLocation";
import { useOfflineJourney } from "../hooks/useOfflineJourney";

export function JourneyMockMap({
  trip,
  mode = "PLAN",
  fallbackReason,
}: {
  trip: Trip;
  mode?: MapMode;
  fallbackReason?: string;
}) {
  const selectedPlaceId = useUiStore((s) => s.selectedPlaceId);
  const hoverPlaceId = useUiStore((s) => s.hoverPlaceId);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const hoverPlace = useUiStore((s) => s.hoverPlace);
  const setActiveDay = useUiStore((s) => s.setActiveDay);

  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
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

  const markers = useMemo(() => {
    return buildJourneyMarkers(trip, {
      activeDayId,
      selectedPlaceId,
      hoverPlaceId,
      mapMode: mode,
      layers,
      zoom: 13 * zoom,
    });
  }, [trip, activeDayId, selectedPlaceId, hoverPlaceId, mode, layers, zoom]);

  const routes = useMemo(() => {
    return buildJourneyRoutes(trip, {
      activeDayId,
      selectedPlaceId,
      hoverPlaceId,
      selectedRouteId,
      mapMode: mode,
      zoom: 13 * zoom,
    });
  }, [trip, activeDayId, selectedPlaceId, hoverPlaceId, selectedRouteId, mode, zoom]);

  const width = 960;
  const height = 720;

  const selectedPlace = trip.places.find((p) => p.id === selectedPlaceId) ?? null;
  const selectedSegment = trip.segments.find((s) => s.id === selectedRouteId) ?? null;

  // Next stop for Today mode
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
      {fallbackReason ? <div className="pointer-events-none absolute left-3 right-3 top-14 z-10 rounded-xl border border-amber-300/70 bg-amber-50/95 px-3 py-2 text-[11px] leading-4 text-amber-900 shadow-sm">地图底图暂为交互式备用视图：{fallbackReason}<br /><span className="text-amber-700/80">POI 和路线数据仍按各自来源标签显示。</span></div> : null}
      {/* Subtle clean basemap background */}
      <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(#d4d4d8_1px,transparent_1px)] [background-size:16px_16px]" />

      {/* Top Left Day Switcher */}
      <DaySwitcher
        days={trip.days}
        activeDayId={activeDayId}
        onSelectDay={(d) => {
          setActiveDay(d);
          setUserInteracted(false);
        }}
        onOpenOverview={() => setOverviewOpen(true)}
      />

      {/* Top Right Map Toolbar */}
      <MapToolbar
        onLocate={() => {
          requestLocation();
          setUserInteracted(true);
        }}
        onFitDay={() => {
          setUserInteracted(false);
          setZoom(1);
        }}
        onFitTrip={() => {
          setActiveDay(null);
          setUserInteracted(false);
          setZoom(0.9);
        }}
        onZoomIn={() => {
          setZoom((z) => Math.min(1.8, z + 0.15));
          setUserInteracted(true);
        }}
        onZoomOut={() => {
          setZoom((z) => Math.max(0.6, z - 0.15));
          setUserInteracted(true);
        }}
        onRecenter={() => {
          setUserInteracted(false);
          setZoom(1);
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
            if (nextPlace) selectPlace(nextPlace.id);
          }}
        />
      ) : null}

      {/* Main SVG Visualization */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        style={{ transform: `scale(${zoom})`, transformOrigin: "center", transition: "transform 0.2s ease-out" }}
        onMouseDown={() => setUserInteracted(true)}
      >
        {/* Simplified subtle stylized water / river background */}
        <path
          d="M80 40 C 220 20, 380 60, 520 40 S 820 80, 860 180 L 840 520 C 700 640, 420 700, 180 620 L 40 360 Z"
          fill="#eaebee"
        />
        <path
          d="M120 260 C 280 240, 400 300, 560 280 S 760 360, 800 420"
          fill="none"
          stroke="#cbd5e1"
          strokeWidth="20"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Polylines with mode-specific styles */}
        {routes.map((route) => {
          const d = route.path
            .map((p, i) => {
              const { x, y } = project(p, width, height);
              return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");

          const strokeDasharray =
            route.strokeStyle === "dashed"
              ? (route.strokeDasharray || [6, 6]).join(" ")
              : undefined;

          return (
            <path
              key={route.id}
              d={d}
              fill="none"
              stroke={route.color}
              strokeWidth={route.strokeWeight}
              strokeOpacity={route.strokeOpacity}
              strokeDasharray={strokeDasharray}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="cursor-pointer transition-all hover:stroke-width-[6px]"
              onClick={() => {
                setSelectedRouteId(route.segmentId);
                selectPlace(null);
              }}
            />
          );
        })}
      </svg>

      {/* HTML Markers & Route Capsules Layer */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: `scale(${zoom})`, transformOrigin: "center", transition: "transform 0.2s ease-out" }}
      >
        {/* Route Badges */}
        {routes
          .filter((r) => r.badge)
          .map((route) => {
            const badge = route.badge!;
            const { x, y } = project(badge.position, width, height);
            return (
              <div
                key={`badge-${route.id}`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 z-10"
                style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }}
              >
                <RouteBadgeComponent
                  badge={badge}
                  onClick={() => {
                    setSelectedRouteId(badge.segmentId);
                    selectPlace(null);
                  }}
                />
              </div>
            );
          })}

        {/* User Location Marker */}
        {userLocation ? (
          <div
            className="pointer-events-none absolute z-20"
            style={{
              left: `${(project(userLocation, width, height).x / width) * 100}%`,
              top: `${(project(userLocation, width, height).y / height) * 100}%`,
            }}
          >
            <UserLocationMarker location={userLocation} />
          </div>
        ) : null}

        {/* Markers */}
        {markers.map((marker) => {
          const { x, y } = project(marker, width, height);
          return (
            <div
              key={marker.id}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${(x / width) * 100}%`,
                top: `${(y / height) * 100}%`,
                zIndex: marker.isSelected ? 40 : marker.isHovered ? 30 : marker.isNext ? 25 : 10,
              }}
            >
              <PlaceMarker
                marker={marker}
                onClick={() => {
                  selectPlace(marker.placeId);
                  setSelectedRouteId(null);
                }}
                onMouseEnter={() => hoverPlace(marker.placeId)}
                onMouseLeave={() => hoverPlace(null)}
              />
            </div>
          );
        })}
      </div>

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
          setUserInteracted(false);
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
        /* Scrubber toggle trigger in corner */
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
