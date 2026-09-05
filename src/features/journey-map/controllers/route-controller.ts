import { DAY_COLORS, type GeoPoint, type RouteSegment, type TransportKind, type Trip } from "@/types/travel";
import {
  calculatePolylineMidpoint,
  type JourneyRoute,
  type RouteBadge,
  type RouteVisualState,
} from "../models/route-model";
export { calculatePolylineMidpoint };
import type { MapMode } from "../models/map-state";

export interface BuildRoutesOptions {
  activeDayId: string | null;
  selectedPlaceId: string | null;
  hoverPlaceId: string | null;
  selectedRouteId: string | null;
  mapMode: MapMode;
  zoom?: number;
}

const MODE_ICONS: Record<TransportKind, string> = {
  walk: "🚶",
  metro: "🚇",
  bus: "🚌",
  taxi: "🚕",
  drive: "🚗",
  highspeed: "🚄",
  flight: "✈️",
};

export function getModeIcon(mode: TransportKind): string {
  return MODE_ICONS[mode] || "🚗";
}

export function formatRouteBadgeText(seg: RouteSegment): string {
  const icon = getModeIcon(seg.mode);
  const minutes = seg.durationMinutes || seg.minutes || 10;
  if (seg.estimatedCost && seg.estimatedCost > 0) {
    return `${icon} ${minutes} min · ¥${Math.round(seg.estimatedCost)}`;
  }
  if (seg.mode === "taxi") {
    // Heuristic taxi cost if not set: base ¥10 + ¥2.5/km
    const km = (seg.distanceMeters || seg.meters || 2000) / 1000;
    const est = Math.round(10 + km * 2.5);
    return `${icon} ${minutes} min · ¥${est}`;
  }
  if (seg.mode === "metro") {
    return `M · ${minutes} min`;
  }
  return `${icon} ${minutes} min`;
}

export function buildJourneyRoutes(trip: Trip, options: BuildRoutesOptions): JourneyRoute[] {
  const { activeDayId, selectedPlaceId, hoverPlaceId, selectedRouteId, mapMode, zoom = 13 } = options;

  const routes: JourneyRoute[] = [];

  trip.days.forEach((day) => {
    const dayColor = DAY_COLORS[day.index % DAY_COLORS.length];
    const isDayActive = !activeDayId || activeDayId === day.id;
    const daySegments = trip.segments.filter((s) => s.dayId === day.id);

    daySegments.forEach((seg) => {
      const fromPlace = trip.places.find((p) => p.id === seg.fromPlaceId);
      const toPlace = trip.places.find((p) => p.id === seg.toPlaceId);

      // Determine points
      const path: GeoPoint[] = [];
      if (seg.polyline && seg.polyline.length > 1) {
        seg.polyline.forEach(([lng, lat]) => path.push({ lat, lng }));
      } else if (fromPlace && toPlace) {
        path.push({ lat: fromPlace.lat, lng: fromPlace.lng });
        path.push({ lat: toPlace.lat, lng: toPlace.lng });
      }

      if (path.length < 2) return;

      // Determine visual state
      const isSelected =
        selectedRouteId === seg.id ||
        (selectedPlaceId !== null &&
          (seg.fromPlaceId === selectedPlaceId || seg.toPlaceId === selectedPlaceId));

      const isHovered =
        hoverPlaceId !== null &&
        (seg.fromPlaceId === hoverPlaceId || seg.toPlaceId === hoverPlaceId);

      let state: RouteVisualState = "PLANNED";
      if (seg.estimated || seg.provider === "haversine") {
        state = "ESTIMATED";
      }

      // Check item status for Today mode
      const fromItem = trip.items.find((i) => i.id === seg.fromItemId);
      const toItem = trip.items.find((i) => i.id === seg.toItemId);
      if (mapMode === "TODAY") {
        if (fromItem?.status === "done" && toItem?.status === "done") {
          state = "COMPLETED";
        } else if (fromItem?.status === "current" || toItem?.status === "current") {
          state = "ACTIVE";
        }
      }

      if (isSelected || isHovered) {
        state = "ACTIVE";
      }

      // Compute stroke styling based on transport mode
      let strokeWeight = 4;
      let strokeStyle: "solid" | "dashed" = "solid";
      let strokeDasharray: number[] | undefined = undefined;

      switch (seg.mode) {
        case "walk":
          strokeWeight = 3;
          strokeStyle = "dashed";
          strokeDasharray = [4, 6];
          break;
        case "metro":
          strokeWeight = 5;
          strokeStyle = "solid";
          break;
        case "bus":
          strokeWeight = 4;
          strokeStyle = "solid";
          break;
        case "taxi":
        case "drive":
          strokeWeight = 4;
          strokeStyle = "dashed";
          strokeDasharray = [8, 6];
          break;
        case "highspeed":
        case "flight":
          strokeWeight = 5;
          strokeStyle = "dashed";
          strokeDasharray = [12, 6];
          break;
        default:
          strokeWeight = 4;
          break;
      }

      // If estimated route, emphasize dashed lines
      if (seg.estimated) {
        strokeStyle = "dashed";
        strokeDasharray = [6, 6];
      }

      // Determine opacity
      let strokeOpacity = 0.85;
      if (!isDayActive) {
        strokeOpacity = 0.18; // non-active days dimmed
      } else if (state === "COMPLETED") {
        strokeOpacity = 0.35;
      } else if (state === "ACTIVE") {
        strokeOpacity = 1.0;
        strokeWeight += 1.5;
      }

      // Route capsule (RouteBadge)
      let badge: RouteBadge | undefined = undefined;
      const shouldShowBadge =
        (isDayActive || isSelected) &&
        (zoom >= 12 || isSelected || mapMode === "TODAY") &&
        path.length >= 2;

      if (shouldShowBadge && fromPlace && toPlace) {
        const midpoint = calculatePolylineMidpoint(path);
        badge = {
          segmentId: seg.id,
          fromPlaceName: fromPlace.name,
          toPlaceName: toPlace.name,
          mode: seg.mode,
          iconText: getModeIcon(seg.mode),
          label: formatRouteBadgeText(seg),
          durationMinutes: seg.durationMinutes || seg.minutes || 10,
          distanceMeters: seg.distanceMeters || seg.meters || 0,
          estimatedCost: seg.estimatedCost,
          position: midpoint,
          isReal: !seg.estimated && seg.provider === "amap",
          state,
        };
      }

      routes.push({
        id: `route-${seg.id}`,
        segmentId: seg.id,
        dayId: day.id,
        dayIndex: day.index,
        fromPlaceId: seg.fromPlaceId,
        toPlaceId: seg.toPlaceId,
        mode: seg.mode,
        color: dayColor,
        state,
        path,
        strokeWeight,
        strokeOpacity,
        strokeStyle,
        strokeDasharray,
        badge,
        isEstimated: Boolean(seg.estimated),
        provider: seg.provider,
      });
    });
  });

  return routes;
}
