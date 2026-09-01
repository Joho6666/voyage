"use client";

import { useMemo, useRef, useState } from "react";
import { Layers, LocateFixed, Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buildMapModel } from "@/services/map/controller";
import { project } from "@/lib/map-project";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import type { MapFilter } from "@/store/ui-store";
import { KindDot, NumberMarker } from "./NumberMarker";
import { PoiPreview } from "./PoiPreview";
import { cn } from "@/lib/utils";

const FILTERS: { id: MapFilter; label: string }[] = [
  { id: "attraction", label: "景点" },
  { id: "food", label: "美食" },
  { id: "cafe", label: "咖啡" },
  { id: "hotel", label: "酒店" },
  { id: "activity", label: "活动" },
];

export function MockMap() {
  const trip = useTripStore((s) => s.trip);
  const selectedId = useUiStore((s) => s.selectedPlaceId);
  const hoverId = useUiStore((s) => s.hoverPlaceId);
  const filters = useUiStore((s) => s.mapFilters);
  const search = useUiStore((s) => s.mapSearch);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const hoverPlace = useUiStore((s) => s.hoverPlace);
  const setSearch = useUiStore((s) => s.setMapSearch);
  const toggleFilter = useUiStore((s) => s.toggleMapFilter);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  const model = useMemo(
    () =>
      buildMapModel(trip, {
        selectedId,
        hoverId,
        filters,
        search,
        activeDayId,
      }),
    [trip, selectedId, hoverId, filters, search, activeDayId],
  );

  const selected = trip.places.find((p) => p.id === selectedId);
  const width = 900;
  const height = 720;

  return (
    <div ref={box} className="relative h-full min-h-[320px] overflow-hidden bg-[var(--map-water)]">
      <div className="pointer-events-none absolute inset-0 map-dots opacity-70" />
      <div className="absolute left-3 top-3 z-10 w-[min(100%-1.5rem,360px)] space-y-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索景点、餐厅、咖啡店……"
          className="pointer-events-auto h-10 bg-surface/95 shadow-[var(--shadow-float)]"
        />
        <div className="pointer-events-auto flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => toggleFilter(f.id)}
              className={cn(
                "rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground",
                filters.includes(f.id) && "border-primary bg-accent text-accent-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        <MapBtn onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))} label="放大">
          <Plus className="size-4" />
        </MapBtn>
        <MapBtn onClick={() => setZoom((z) => Math.max(0.8, z - 0.15))} label="缩小">
          <Minus className="size-4" />
        </MapBtn>
        <MapBtn onClick={() => setZoom(1)} label="定位">
          <LocateFixed className="size-4" />
        </MapBtn>
        <MapBtn label="图层">
          <Layers className="size-4" />
        </MapBtn>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
      >
        <rect width={width} height={height} fill="var(--map-water)" />
        <path
          d="M80 40 C 220 20, 380 60, 520 40 S 820 80, 860 180 L 840 520 C 700 640, 420 700, 180 620 L 40 360 Z"
          fill="var(--map-land)"
        />
        <path
          d="M120 260 C 280 240, 400 300, 560 280 S 760 360, 800 420"
          fill="none"
          stroke="#9db7b4"
          strokeWidth="18"
          strokeLinecap="round"
          opacity="0.7"
        />
        {model.polylines.map((line) => {
          const d = line.path
            .map((p, i) => {
              const { x, y } = project(p, width, height);
              return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          return (
            <path
              key={line.id}
              d={d}
              fill="none"
              stroke={line.color}
              strokeWidth="3.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {model.markers.map((marker) => {
        const { x, y } = project(marker, width, height);
        const left = `${(x / width) * 100}%`;
        const top = `${(y / height) * 100}%`;
        return (
          <div
            key={marker.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left, top, zIndex: marker.selected ? 20 : 5 }}
            onMouseEnter={() => hoverPlace(marker.id)}
            onMouseLeave={() => hoverPlace(null)}
          >
            {marker.number ? (
              <NumberMarker marker={marker} hovered={hoverId === marker.id} onSelect={selectPlace} />
            ) : (
              <KindDot marker={marker} onSelect={selectPlace} />
            )}
          </div>
        );
      })}

      {selected ? (
        <div className="absolute bottom-4 left-4 z-20 max-w-[260px]">
          <PoiPreview place={selected} />
        </div>
      ) : null}
    </div>
  );
}

function MapBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-[10px] border border-border bg-surface text-foreground shadow-[var(--shadow-float)] hover:bg-secondary"
    >
      {children}
    </button>
  );
}
