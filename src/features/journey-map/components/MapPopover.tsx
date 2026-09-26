"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { TravelImage } from "@/components/travel/TravelImage";
import { PLACE_CATEGORY_LABEL, type Place, type RouteSegment, type Trip } from "@/types/travel";
import { travelAgent } from "@/services/ai";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { toast } from "sonner";
import { Navigation, Clock, Star, X, ChevronUp, ChevronDown } from "lucide-react";
import { getModeIcon } from "../controllers/route-controller";
import { formatKm } from "@/lib/utils";
import { VerticalTransitGuide } from "./VerticalTransitGuide";

export function MapPopover({
  place,
  segment,
  trip,
  onClose,
}: {
  place: Place | null;
  segment?: RouteSegment | null;
  trip: Trip;
  onClose: () => void;
}) {
  const patch = useTripStore((s) => s.patchTrip);
  const activeDayId = useUiStore((s) => s.activeDayId) ?? trip.days[0]?.id;
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // If a route segment is selected, show Route Detail Popover
  if (segment && !place) {
    const fromPlace = trip.places.find((p) => p.id === segment.fromPlaceId);
    const toPlace = trip.places.find((p) => p.id === segment.toPlaceId);
    const icon = getModeIcon(segment.mode);
    const isReal = !segment.estimated && segment.provider === "amap";
    const meters = segment.distanceMeters ?? segment.meters ?? 0;
    const minutes = segment.durationMinutes ?? segment.minutes ?? 0;

    const openNavigation = () => {
      if (!toPlace) return;
      const mode = segment.mode === "walk" ? "walk" : segment.mode === "metro" ? "bus" : "car";
      const amapUrl = `https://uri.amap.com/navigation?to=${toPlace.lng},${toPlace.lat}&toname=${encodeURIComponent(toPlace.name)}&mode=${mode}&policy=1`;
      window.open(amapUrl, "_blank", "noopener,noreferrer");
    };

    return (
      <div className="absolute bottom-4 left-4 z-20 w-[280px] rounded-[14px] border border-border bg-surface/95 p-3.5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{icon}</span>
            <span className="text-sm font-semibold text-foreground">
              {fromPlace?.name} → {toPlace?.name}
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

        <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="font-semibold text-foreground">{minutes} 分钟</span>
          <span>·</span>
          <span>{formatKm(meters)}</span>
          <span>·</span>
          <span className={isReal ? "text-emerald-600 font-medium" : "text-amber-600"}>
            {isReal ? "高德实时路线" : "直线预估"}
          </span>
        </div>

        {segment.estimatedCost ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            预估费用：约 ¥{Math.round(segment.estimatedCost)}
          </p>
        ) : null}

        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 text-[12px] h-8" onClick={onClose}>
            关闭
          </Button>
          <Button size="sm" className="flex-1 text-[12px] h-8 gap-1" onClick={openNavigation}>
            <Navigation className="size-3" />
            开始导航
          </Button>
        </div>
      </div>
    );
  }

  if (!place) return null;

  // Check if place belongs to itinerary and find its time slot
  const itineraryItem = trip.items.find((i) => i.placeId === place.id);

  const openNavigation = () => {
    const amapUrl = `https://uri.amap.com/navigation?to=${place.lng},${place.lat}&toname=${encodeURIComponent(place.name)}&mode=car&policy=1`;
    window.open(amapUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      {/* Desktop Floating Card */}
      <div
        data-testid="map-popover"
        className="voyage-map-popover hidden md:block absolute bottom-4 left-4 z-20 w-[270px] overflow-hidden rounded-[14px] border border-border bg-surface/95 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        <div className="relative">
          {place.image ? (
            <TravelImage src={place.image} alt={place.name} ratio="16/9" className="h-28 w-full object-cover" />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label="关闭详情"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-1.5 p-3.5">
          <div className="flex items-start justify-between gap-1">
            <h3 className="text-sm font-semibold text-foreground truncate">{place.name}</h3>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0">
              {PLACE_CATEGORY_LABEL[place.category]}
            </span>
          </div>

          {itineraryItem?.startTime ? (
            <div className="flex items-center gap-1 text-[11px] font-medium text-primary">
              <Clock className="size-3" />
              <span>
                {itineraryItem.startTime}
                {itineraryItem.endTime ? ` – ${itineraryItem.endTime}` : ""}
                {place.stayMinutes ? ` · 停留 ${place.stayMinutes}m` : ""}
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              停留约 {place.stayMinutes} 分钟 · {place.priceLabel}
            </p>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-0.5 text-amber-600 font-medium">
              <Star className="size-3 fill-current" />
              {place.rating.toFixed(1)}
            </span>
            <span>·</span>
            <span>{place.openingStatus === "open" ? "营业中" : "时段未知"}</span>
          </div>

          <p className="line-clamp-2 text-[11px] text-muted-foreground leading-relaxed pt-0.5">
            {place.description}
          </p>

          {place.vertical ? <VerticalTransitGuide vertical={place.vertical} className="mt-1" /> : null}

          <div className="flex gap-1.5 pt-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[11px] h-7.5 px-2"
              onClick={() => toast.message(place.description)}
            >
              详情
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[11px] h-7.5 px-2 gap-1"
              onClick={openNavigation}
            >
              <Navigation className="size-3 text-primary" />
              导航
            </Button>
            {!itineraryItem ? (
              <Button
                size="sm"
                className="flex-1 text-[11px] h-7.5 px-2"
                onClick={() => {
                  if (!activeDayId) return;
                  patch((t) => travelAgent.addItem(t, place.id, activeDayId));
                  toast.success(`已加入 ${trip.days.find((d) => d.id === activeDayId)?.title ?? "行程"}`);
                }}
              >
                加入
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Floating Card (Compact & Expandable) */}
      <div data-testid="map-popover" className="md:hidden absolute inset-x-3 bottom-3 z-30 overflow-hidden rounded-[16px] border border-border bg-surface/95 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground truncate">{place.name}</h3>
              {itineraryItem ? (
                <span className="text-[11px] font-medium text-primary shrink-0">
                  {itineraryItem.startTime}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {place.rating.toFixed(1)}分 · {PLACE_CATEGORY_LABEL[place.category]} · {place.priceLabel}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => setMobileExpanded(!mobileExpanded)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              {mobileExpanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {mobileExpanded ? (
          <div className="p-3.5 pt-2 space-y-2 text-[12px] text-muted-foreground">
            {place.image ? (
              <TravelImage src={place.image} alt={place.name} ratio="16/9" className="h-24 w-full rounded-[10px] object-cover" />
            ) : null}
            <p className="leading-relaxed">{place.description}</p>
            {place.vertical ? <VerticalTransitGuide vertical={place.vertical} className="mt-1" /> : null}
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" className="flex-1 text-[12px] h-8 gap-1" onClick={openNavigation}>
                <Navigation className="size-3.5 text-primary" />
                高德导航
              </Button>
              {!itineraryItem ? (
                <Button
                  size="sm"
                  className="flex-1 text-[12px] h-8"
                  onClick={() => {
                    if (!activeDayId) return;
                    patch((t) => travelAgent.addItem(t, place.id, activeDayId));
                    toast.success("已加入今日行程");
                  }}
                >
                  加入今日
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
