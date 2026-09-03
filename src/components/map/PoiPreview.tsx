"use client";

import { Button } from "@/components/ui/button";
import { TravelImage } from "@/components/travel/TravelImage";
import { PLACE_CATEGORY_LABEL, type Place } from "@/types/travel";
import { travelAgent } from "@/services/ai";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { toast } from "sonner";

export function PoiPreview({ place }: { place: Place }) {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const dayId = useUiStore((s) => s.activeDayId) ?? trip.days[0]?.id;

  return (
    <div className="w-[240px] overflow-hidden rounded-[12px] border border-border bg-surface shadow-[var(--shadow-float)]">
      <TravelImage src={place.image} alt={place.name} ratio="16/9" />
      <div className="space-y-1 p-3">
        <p className="text-sm font-medium leading-5">{place.name}</p>
        <p className="text-[12px] text-muted-foreground">
          {place.rating.toFixed(1)} · {PLACE_CATEGORY_LABEL[place.category]} · {place.priceLabel}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {place.openingStatus === "open" ? "开放中" : place.openingStatus === "closed" ? "已关闭" : "时段未知"}
        </p>
        <div className="flex gap-1.5 pt-1">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => toast.message(place.description)}>
            查看详情
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              if (!dayId) return;
              patch((t) => travelAgent.addItem(t, place.id, dayId));
              toast.success(`已加入 ${trip.days.find((d) => d.id === dayId)?.title ?? "行程"}`);
            }}
          >
            加入行程
          </Button>
        </div>
      </div>
    </div>
  );
}
