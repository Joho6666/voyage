"use client";

import { TravelImage } from "@/components/travel/TravelImage";
import { AddToDay } from "@/components/travel/AddToDay";
import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";

const CUISINES = ["火锅", "小面", "江湖菜", "烧烤", "甜品", "夜宵", "咖啡"];

export default function FoodPage() {
  const trip = useTripStore((s) => s.trip);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">重庆必吃</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CUISINES.map((c) => (
          <span key={c} className="rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
      <div className="mt-5 space-y-4">
        {trip.restaurants.map((r) => {
          const place = trip.places.find((p) => p.id === r.placeId);
          if (!place) return null;
          return (
            <article key={r.id} className="overflow-hidden rounded-[14px] border border-border">
              <TravelImage src={place.image} alt={place.name} />
              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-medium">{place.name}</h2>
                    <p className="text-[12px] text-muted-foreground">
                      {r.cuisine} · {r.signature} · 人均 {formatCny(r.avgSpend)}
                    </p>
                  </div>
                  <AddToDay placeId={place.id} label="加入 Day 1 午餐" />
                </div>
                <p className="text-[13px] leading-5 text-muted-foreground">{r.why}</p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
