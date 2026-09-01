"use client";

import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import { formatKm } from "@/lib/utils";
import { toast } from "sonner";

export default function TodayPage() {
  const trip = useTripStore((s) => s.trip);
  const day = trip.days[1] ?? trip.days[0];
  const items = trip.items.filter((i) => i.dayId === day.id).sort((a, b) => a.order - b.order);
  const current = items[0];
  const place = trip.places.find((p) => p.id === current?.placeId);
  const segment = trip.segments.find((s) => s.fromItemId === current?.id);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <p className="text-[13px] text-muted-foreground">{trip.destination}</p>
      <h1 className="mt-1 text-2xl font-medium">Day {day.index + 1}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {day.weather.tempC}°C · {day.weather.condition}
      </p>

      <section className="mt-6 rounded-[14px] border border-border p-4">
        <p className="text-[12px] uppercase tracking-wider text-muted-foreground">下一站</p>
        <h2 className="mt-1 text-2xl font-medium">{place?.name ?? "—"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{current?.startTime}</p>
        {segment ? (
          <p className="mt-2 text-sm text-muted-foreground">
            距离 {formatKm(segment.meters)} · 预计 {segment.minutes} min
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">今日第一站，就近出发。</p>
        )}
        <Button className="mt-4 w-full" size="lg" onClick={() => toast.message("导航使用 Mock Location")}>
          开始导航
        </Button>
      </section>

      <ol className="mt-6 space-y-2">
        {items.map((item, index) => {
          const p = trip.places.find((x) => x.id === item.placeId);
          const state = index === 0 ? "current" : "todo";
          return (
            <li key={item.id} className="flex items-center gap-3 text-sm">
              <span className="grid size-5 place-items-center text-[12px]">
                {state === "current" ? "●" : "○"}
              </span>
              <span className="w-12 tabular-nums text-muted-foreground">{item.startTime}</span>
              <span>{p?.name}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
