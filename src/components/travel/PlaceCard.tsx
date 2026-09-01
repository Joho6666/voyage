import { Star } from "lucide-react";
import { TravelImage } from "./TravelImage";
import { AddToDay } from "./AddToDay";
import { PLACE_CATEGORY_LABEL, type Place } from "@/types/travel";
import { formatKm, haversineMeters } from "@/lib/utils";

export function PlaceCard({ place, from }: { place: Place; from?: { lat: number; lng: number } }) {
  const distance = from ? formatKm(haversineMeters(from, place)) : place.district;

  return (
    <article className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <TravelImage src={place.image} alt={place.name} ratio="4/3" />
      <div className="space-y-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium">{place.name}</h3>
          <AddToDay placeId={place.id} />
        </div>
        <p className="flex flex-wrap gap-x-2 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <Star className="size-3 fill-current" />
            {place.rating.toFixed(1)}
          </span>
          <span>{place.reviewCount.toLocaleString()} 评价</span>
          <span>{PLACE_CATEGORY_LABEL[place.category]}</span>
          <span>{distance}</span>
          <span>{place.priceLabel}</span>
        </p>
      </div>
    </article>
  );
}
