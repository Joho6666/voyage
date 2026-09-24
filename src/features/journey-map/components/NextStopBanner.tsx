"use client";

import React from "react";
import type { Place, RouteSegment } from "@/types/travel";
import { formatKm } from "@/lib/utils";
import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getModeIcon } from "../controllers/route-controller";
import { VerticalTransitGuide } from "./VerticalTransitGuide";

export function NextStopBanner({
  nextPlace,
  currentPlace,
  segment,
  locationError,
  onRequestLocation,
  onFocusNext,
}: {
  nextPlace?: Place;
  currentPlace?: Place;
  segment?: RouteSegment;
  locationError?: string | null;
  onRequestLocation?: () => void;
  onFocusNext?: () => void;
}) {
  const target = nextPlace ?? currentPlace;
  if (!target) return null;

  const modeIcon = segment ? getModeIcon(segment.mode) : "🚶";
  const modeLabel =
    segment?.mode === "metro"
      ? "地铁"
      : segment?.mode === "taxi"
        ? "出租"
        : segment?.mode === "bus"
          ? "公交"
          : "步行";
  const duration = segment?.durationMinutes || segment?.minutes || 15;
  const meters = segment?.distanceMeters || segment?.meters || 1200;

  const handleOpenNavigation = () => {
    const amapUrl = `https://uri.amap.com/navigation?to=${target.lng},${target.lat}&toname=${encodeURIComponent(target.name)}&mode=car&policy=1`;
    window.open(amapUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="absolute top-3 inset-x-3 md:inset-x-auto md:left-4 z-20 md:w-[320px] rounded-[16px] border border-border/80 bg-surface/95 p-3.5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
              NEXT STOP
            </span>
            <span className="text-[11px] text-muted-foreground">下一站</span>
          </div>
          <h2
            onClick={onFocusNext}
            className="mt-1 text-base font-semibold text-foreground truncate cursor-pointer hover:text-primary transition-colors"
          >
            {target.name}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {modeIcon} {modeLabel} {duration} min · {formatKm(meters)}
          </p>
          {target.vertical ? (
            <div className="mt-1">
              <VerticalTransitGuide vertical={target.vertical} compact />
            </div>
          ) : null}
        </div>

        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-[12px] shadow-xs"
          onClick={handleOpenNavigation}
        >
          <Navigation className="size-3.5" />
          导航
        </Button>
      </div>

      {locationError ? (
        <div
          onClick={onRequestLocation}
          className="mt-2.5 flex items-center justify-between rounded-[8px] bg-secondary/70 px-2.5 py-1.5 text-[11px] text-muted-foreground cursor-pointer hover:bg-secondary transition-colors"
        >
          <span>{locationError}</span>
          <span className="text-primary font-medium ml-2">开启定位</span>
        </div>
      ) : null}
    </div>
  );
}
