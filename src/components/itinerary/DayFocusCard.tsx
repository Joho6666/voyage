"use client";

import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TravelImage } from "@/components/travel/TravelImage";
import { dayStats } from "@/services/routing";
import { formatKm } from "@/lib/utils";
import { useTripStore } from "@/store/trip-store";
import { toast } from "sonner";
import type { Day, Place, Trip } from "@/types/travel";

/** The day's next uncompleted stop, derived the same way in every view. */
export function nextStopFor(trip: Trip, day: Day | undefined) {
  if (!day) return {};
  const items = trip.items.filter((item) => item.dayId === day.id).sort((a, b) => a.order - b.order);
  const currentIndex = items.findIndex((item) => item.status !== "done");
  const current = items[currentIndex >= 0 ? currentIndex : 0];
  const next = items[currentIndex >= 0 ? currentIndex + 1 : 1] ?? current;
  return {
    items,
    current,
    next,
    currentPlace: trip.places.find((place) => place.id === current?.placeId),
    nextPlace: trip.places.find((place) => place.id === next?.placeId),
    segment: trip.segments.find((s) => s.fromItemId === current?.id),
    doneCount: items.filter((item) => item.status === "done").length,
  };
}

export function openAmapNavigation(place: Place | undefined, mode: string | undefined) {
  if (!place) {
    toast.error("未找到目的地坐标");
    return;
  }
  const amapMode = mode === "walk" ? "walk" : mode === "metro" ? "bus" : "car";
  const url = `https://uri.amap.com/navigation?to=${place.lng},${place.lat}&toname=${encodeURIComponent(place.name)}&mode=${amapMode}&policy=1`;
  window.open(url, "_blank", "noopener,noreferrer");
}

const MODE_LABELS: Record<string, string> = { metro: "地铁", walk: "步行", taxi: "打车", bus: "公交", drive: "自驾" };

/**
 * "What do I do today" — the next stop and one tap to navigate. Shared by the
 * trip workspace and the today view so both answer the same question instead of
 * leaving the traveller to interpret a list of stops.
 */
export function DayFocusCard({ day, className }: { day: Day; className?: string }) {
  const trip = useTripStore((s) => s.trip);
  const { items, next, nextPlace, segment, doneCount } = nextStopFor(trip, day);

  if (!items?.length) {
    return (
      <section className={className} aria-label="今天做什么">
        <p className="rounded-[16px] border border-border bg-surface p-3 text-xs text-muted-foreground">
          这一天还没有安排。可以切到「探索」挑几个地点，或者直接问 Voyage。
        </p>
      </section>
    );
  }

  const stats = dayStats(trip, day.id);
  const modeLabel = MODE_LABELS[segment?.mode ?? ""] ?? "前往";

  return (
    <section className={className} aria-label="今天做什么">
      <div className="rounded-[16px] border border-primary/20 bg-accent/45 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-primary">下一站</p>
            <h3 className="mt-1 truncate text-base font-semibold">{nextPlace?.name ?? "今天的安排已完成"}</h3>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {next?.startTime ? `计划 ${next.startTime} · ` : ""}
              {modeLabel}
              {segment?.durationMinutes ? ` 约 ${segment.durationMinutes} 分钟` : ""}
              {nextPlace?.district ? ` · ${nextPlace.district}` : ""}
            </p>
          </div>
          {nextPlace?.image ? (
            <TravelImage src={nextPlace.image} alt={nextPlace.name} className="size-16 shrink-0 rounded-xl object-cover" />
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => openAmapNavigation(nextPlace, segment?.mode)} disabled={!nextPlace}>
            <Navigation className="mr-1 size-3.5" />开始导航
          </Button>
          <span className="text-[11px] text-muted-foreground">
            今日 {doneCount}/{items.length} 完成 · 步行 {stats.walkMin} 分钟 · {formatKm(stats.meters)}
          </span>
        </div>
      </div>
    </section>
  );
}
