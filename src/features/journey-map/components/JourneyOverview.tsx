"use client";

import React from "react";
import { formatKm } from "@/lib/utils";
import { DAY_COLORS, type Trip } from "@/types/travel";
import { X, Footprints, Train, Car } from "lucide-react";

export function JourneyOverview({
  trip,
  open,
  onClose,
  onSelectDay,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
  onSelectDay: (dayId: string | null) => void;
}) {
  if (!open) return null;

  // Calculate overall trip stats
  const totalPlaces = trip.items.filter((i) => i.type !== "note").length;
  const totalMeters = trip.segments.reduce((acc, s) => acc + (s.distanceMeters || s.meters || 0), 0);
  const walkSegments = trip.segments.filter((s) => s.mode === "walk");
  const walkMeters = walkSegments.reduce((acc, s) => acc + (s.distanceMeters || s.meters || 0), 0);
  const walkMin = walkSegments.reduce((acc, s) => acc + (s.durationMinutes || s.minutes || 0), 0);
  const metroMin = trip.segments
    .filter((s) => s.mode === "metro")
    .reduce((acc, s) => acc + (s.durationMinutes || s.minutes || 0), 0);
  const taxiSegments = trip.segments.filter((s) => s.mode === "taxi" || s.mode === "drive");
  const taxiCost = taxiSegments.reduce((acc, s) => {
    if (s.estimatedCost) return acc + s.estimatedCost;
    const km = (s.distanceMeters || s.meters || 2000) / 1000;
    return acc + Math.round(10 + km * 2.5);
  }, 0);

  return (
    <div className="absolute inset-x-4 top-16 z-30 mx-auto max-w-lg rounded-[16px] border border-border/80 bg-surface/95 p-5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-primary uppercase">
            Trip Summary
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {trip.destination} · {trip.days.length} Days 行程总览
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            涵盖 {totalPlaces} 个地点 · 规划总行进 {formatKm(totalMeters)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Core Highlights Cards */}
      <div className="mt-4 grid grid-cols-3 gap-2.5 text-[12px]">
        <div className="rounded-[10px] border border-border/60 bg-secondary/50 p-2.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Footprints className="size-3.5 text-emerald-600" />
            <span>步行</span>
          </div>
          <p className="mt-1 font-semibold text-foreground">
            {formatKm(walkMeters)}
          </p>
          <span className="text-[10px] text-muted-foreground">约 {walkMin} 分钟</span>
        </div>

        <div className="rounded-[10px] border border-border/60 bg-secondary/50 p-2.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Train className="size-3.5 text-teal-600" />
            <span>地铁/公交</span>
          </div>
          <p className="mt-1 font-semibold text-foreground">
            {metroMin} 分钟
          </p>
          <span className="text-[10px] text-muted-foreground">绿色低碳换乘</span>
        </div>

        <div className="rounded-[10px] border border-border/60 bg-secondary/50 p-2.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Car className="size-3.5 text-amber-600" />
            <span>出租/驾车</span>
          </div>
          <p className="mt-1 font-semibold text-foreground">
            约 ¥{taxiCost}
          </p>
          <span className="text-[10px] text-muted-foreground">{taxiSegments.length} 段长距离</span>
        </div>
      </div>

      {/* Per-Day List */}
      <div className="mt-4 space-y-2">
        <span className="text-[12px] font-medium text-foreground">每日路线透视</span>
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {trip.days.map((day) => {
            const color = DAY_COLORS[day.index % DAY_COLORS.length];
            const dayItems = trip.items.filter((i) => i.dayId === day.id);
            const dayMeters = trip.segments
              .filter((s) => s.dayId === day.id)
              .reduce((sum, s) => sum + (s.distanceMeters || s.meters || 0), 0);

            return (
              <div
                key={day.id}
                onClick={() => {
                  onSelectDay(day.id);
                  onClose();
                }}
                className="flex items-center justify-between rounded-[10px] border border-border/60 p-2.5 hover:bg-secondary/60 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full shrink-0" style={{ background: color }} />
                  <div>
                    <span className="text-[13px] font-medium text-foreground">
                      Day {day.index + 1} · {day.title || day.date.slice(5)}
                    </span>
                    <span className="text-[11px] text-muted-foreground ml-2">
                      {dayItems.length} 个地点
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span>{formatKm(dayMeters)}</span>
                  <span className="text-primary text-[11px] font-medium">查看 →</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* View All Button */}
      <button
        type="button"
        onClick={() => {
          onSelectDay(null);
          onClose();
        }}
        className="mt-4 w-full rounded-[10px] bg-primary py-2 text-center text-[12px] font-medium text-white shadow-xs hover:bg-primary/90 transition-colors"
      >
        显示完整三天连续路线
      </button>
    </div>
  );
}
