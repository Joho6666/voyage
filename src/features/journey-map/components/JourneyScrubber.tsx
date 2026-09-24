"use client";

import React, { useMemo, useState } from "react";
import type { Trip } from "@/types/travel";
import { X } from "lucide-react";
import { getModeIcon } from "../controllers/route-controller";

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function JourneyScrubber({
  trip,
  activeDayId,
  onSimulate,
  onClose,
}: {
  trip: Trip;
  activeDayId: string | null;
  onSimulate: (data: { placeId: string | null; routeId: string | null }) => void;
  onClose: () => void;
}) {
  const dayId = activeDayId ?? trip.days[0]?.id;
  const day = trip.days.find((d) => d.id === dayId) ?? trip.days[0];

  const items = useMemo(() => {
    return trip.items.filter((i) => i.dayId === day?.id).sort((a, b) => a.order - b.order);
  }, [trip.items, day?.id]);

  const segments = useMemo(() => {
    return trip.segments.filter((s) => s.dayId === day?.id);
  }, [trip.segments, day?.id]);

  // Compute start and end minutes
  const startMin = useMemo(() => {
    const first = items[0]?.startTime;
    return first ? Math.max(0, timeToMinutes(first) - 30) : 9 * 60;
  }, [items]);

  const endMin = useMemo(() => {
    const last = items[items.length - 1]?.endTime || items[items.length - 1]?.startTime;
    return last ? timeToMinutes(last) + 60 : 21 * 60;
  }, [items]);

  const [currentMin, setCurrentMin] = useState<number>(startMin + 30);

  // Derive simulation status
  const simulation = useMemo(() => {
    // Check if inside a place
    for (const item of items) {
      const s = timeToMinutes(item.startTime);
      const e = item.endTime ? timeToMinutes(item.endTime) : s + item.duration;
      if (currentMin >= s && currentMin <= e) {
        const place = trip.places.find((p) => p.id === item.placeId);
        return {
          status: "at_place",
          place,
          label: `预计位于 ${place?.name || "景点"}`,
          placeId: place?.id || null,
          routeId: null,
        };
      }
    }

    // Check if in transit
    for (let i = 0; i < items.length - 1; i++) {
      const currentItem = items[i];
      const nextItem = items[i + 1];
      const currentEnd = currentItem.endTime
        ? timeToMinutes(currentItem.endTime)
        : timeToMinutes(currentItem.startTime) + currentItem.duration;
      const nextStart = timeToMinutes(nextItem.startTime);

      if (currentMin > currentEnd && currentMin < nextStart) {
        const nextPlace = trip.places.find((p) => p.id === nextItem.placeId);
        const seg = segments.find(
          (s) => s.fromItemId === currentItem.id && s.toItemId === nextItem.id,
        );
        const modeLabel =
          seg?.mode === "metro"
            ? "地铁中"
            : seg?.mode === "walk"
              ? "步行中"
              : seg?.mode === "taxi"
                ? "乘车中"
                : "行进中";
        const icon = seg ? getModeIcon(seg.mode) : "🚶";

        return {
          status: "transit",
          place: nextPlace,
          label: `前往 ${nextPlace?.name || "下一站"} · ${icon} ${modeLabel}`,
          placeId: nextPlace?.id || null,
          routeId: seg?.id || null,
        };
      }
    }

    return {
      status: "idle",
      place: null,
      label: currentMin < startMin + 30 ? "今日行程尚未开始" : "今日行程已结束",
      placeId: null,
      routeId: null,
    };
  }, [currentMin, items, segments, trip.places, startMin]);

  const handleSliderChange = (val: number) => {
    setCurrentMin(val);
    onSimulate({ placeId: simulation.placeId, routeId: simulation.routeId });
  };

  return (
    <div className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-md rounded-[14px] border border-border/80 bg-surface/95 p-3.5 shadow-xl backdrop-blur-md animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            行程预演
          </span>
          <span className="text-[12px] font-semibold text-foreground">
            Day {day?.index ? day.index + 1 : 1} · {minutesToTime(currentMin)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {minutesToTime(startMin)}
        </span>
        <input
          type="range"
          min={startMin}
          max={endMin}
          value={currentMin}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-primary"
        />
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {minutesToTime(endMin)}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="font-medium text-foreground truncate">{simulation.label}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">Trip Simulation</span>
      </div>
    </div>
  );
}
