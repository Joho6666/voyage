import { Star } from "lucide-react";
import { TravelImage } from "./TravelImage";
import { AddToDay } from "./AddToDay";
import { PLACE_CATEGORY_LABEL, type Place } from "@/types/travel";
import { formatKm, haversineMeters } from "@/lib/utils";

export function PlaceCard({ place, from }: { place: Place; from?: { lat: number; lng: number } }) {
  const meters = from ? haversineMeters(from, place) : null;
  // A card at the anchor point itself reads "0 m" — meaningless to the user.
  const distance = meters !== null ? (meters < 50 ? "就在附近" : formatKm(meters)) : place.district;
  const hasRealRating = typeof place.rating === "number" && place.rating > 0;

  return (
    <article className="overflow-hidden rounded-[14px] border border-border bg-surface hover:shadow-xs transition-shadow">
      <TravelImage src={place.image} alt={place.name} ratio="4/3" />
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium leading-snug line-clamp-1">{place.name}</h3>
            {place.address ? (
              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{place.address}</p>
            ) : null}
          </div>
          <AddToDay placeId={place.id} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
          {hasRealRating ? (
            <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-medium">
              <Star className="size-3 fill-current" />
              {place.rating.toFixed(1)}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/60">暂无评分</span>
          )}
          {place.reviewCount > 0 ? <span>{place.reviewCount.toLocaleString()} 评价</span> : null}
          <span className="rounded bg-secondary/80 px-1.5 py-0.2 text-[11px]">
            {PLACE_CATEGORY_LABEL[place.category]}
          </span>
          {distance ? <span>{distance}</span> : null}
          {place.priceLabel ? <span className="font-medium text-foreground">{place.priceLabel}</span> : null}
          {place.stayMinutes ? <span>建议 {place.stayMinutes} min</span> : null}
          {place.openingStatus && place.openingStatus !== "unknown" ? (
            <span className={place.openingStatus === "open" ? "text-emerald-600 font-medium" : "text-rose-500"}>
              {place.openingStatus === "open" ? "开放中" : "已闭馆"}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
