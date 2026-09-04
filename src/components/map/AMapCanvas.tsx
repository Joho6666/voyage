"use client";

import { useEffect, useRef, useState } from "react";
import { DAY_COLORS } from "@/types/travel";
import { buildMapModel } from "@/services/map/controller";
import { isAmapJsConfigured, loadAmapJs, type AMapInstance, type AMapOverlay } from "@/services/map/amap-js";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { MockMap } from "./MockMap";
import { PoiPreview } from "./PoiPreview";

export function AMapCanvas() {
  const trip = useTripStore((s) => s.trip);
  const selectedId = useUiStore((s) => s.selectedPlaceId);
  const hoverId = useUiStore((s) => s.hoverPlaceId);
  const filters = useUiStore((s) => s.mapFilters);
  const search = useUiStore((s) => s.mapSearch);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const overlays = useRef<AMapOverlay[]>([]);
  const [failed, setFailed] = useState(!isAmapJsConfigured());

  useEffect(() => {
    if (failed || !container.current) return;
    let cancelled = false;
    void loadAmapJs()
      .then(() => {
        if (cancelled || !container.current || !window.AMap) return;
        const first = trip.places[0];
        mapRef.current = new window.AMap.Map(container.current, {
          zoom: 13,
          center: first ? [first.lng, first.lat] : [106.55, 29.56],
          viewMode: "2D",
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [failed, trip.places]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    if (!map || !AMap) return;
    overlays.current.forEach((overlay) => overlay.setMap(null));
    overlays.current = [];
    const model = buildMapModel(trip, { selectedId, hoverId, filters, search, activeDayId });
    model.polylines.forEach((line) => {
      if (line.path.length < 2) return;
      const polyline = new AMap.Polyline({
        path: line.path.map((p) => [p.lng, p.lat]),
        strokeColor: line.color,
        strokeWeight: 4,
        strokeOpacity: 0.85,
        lineJoin: "round",
      });
      map.add(polyline);
      overlays.current.push(polyline);
    });
    model.markers.forEach((marker) => {
      const color = DAY_COLORS[(marker.dayIndex ?? 0) % DAY_COLORS.length];
      const content = marker.number
        ? `<div style="width:22px;height:22px;border-radius:999px;background:${color};color:#fff;font:600 11px/22px sans-serif;text-align:center;border:2px solid #fff">${marker.number}</div>`
        : `<div style="width:10px;height:10px;border-radius:999px;background:${color};border:2px solid #fff"></div>`;
      const pin = new AMap.Marker({
        position: [marker.lng, marker.lat],
        content,
        offset: new AMap.Pixel(-11, -11),
        zIndex: marker.selected ? 120 : 20,
      });
      pin.on("click", () => selectPlace(marker.id));
      map.add(pin);
      overlays.current.push(pin);
    });
    if (overlays.current.length) map.setFitView(overlays.current, false, [60, 60, 60, 60]);

    if (selectedId) {
      const selectedPlace = trip.places.find((p) => p.id === selectedId);
      if (selectedPlace) {
        map.panTo([selectedPlace.lng, selectedPlace.lat]);
      }
    }
  }, [trip, selectedId, hoverId, filters, search, activeDayId, selectPlace]);

  if (failed) return <MockMap />;

  const selected = trip.places.find((p) => p.id === selectedId);
  return (
    <div className="relative h-full min-h-[320px]">
      <div ref={container} className="h-full w-full" />
      {selected ? (
        <div className="absolute bottom-4 left-4 z-20 max-w-[260px]">
          <PoiPreview place={selected} />
        </div>
      ) : null}
    </div>
  );
}
