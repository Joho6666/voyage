import type { GeoPoint, TransportKind } from "@/types/travel";

export type RouteVisualState = "PLANNED" | "ACTIVE" | "COMPLETED" | "ESTIMATED";

export interface RouteBadge {
  segmentId: string;
  fromPlaceName: string;
  toPlaceName: string;
  mode: TransportKind;
  iconText: string;
  label: string;
  durationMinutes: number;
  distanceMeters: number;
  estimatedCost?: number;
  position: GeoPoint;
  isReal: boolean;
  state: RouteVisualState;
}

export interface JourneyRoute {
  id: string;
  segmentId: string;
  dayId: string;
  dayIndex: number;
  fromPlaceId: string;
  toPlaceId: string;
  mode: TransportKind;
  color: string;
  state: RouteVisualState;
  path: GeoPoint[];
  strokeWeight: number;
  strokeOpacity: number;
  strokeStyle: "solid" | "dashed";
  strokeDasharray?: number[];
  badge?: RouteBadge;
  isEstimated: boolean;
  provider: "amap" | "haversine" | "mock";
}

/**
 * Calculate the geographic midpoint of a polyline path.
 * If multiple points exist, finds the segment that bisects the cumulative distance.
 */
export function calculatePolylineMidpoint(path: GeoPoint[]): GeoPoint {
  if (!path.length) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0];
  if (path.length === 2) {
    return {
      lat: (path[0].lat + path[1].lat) / 2,
      lng: (path[0].lng + path[1].lng) / 2,
    };
  }

  // Calculate cumulative distance
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dLat = path[i + 1].lat - path[i].lat;
    const dLng = path[i + 1].lng - path[i].lng;
    const dist = Math.hypot(dLat, dLng);
    segmentLengths.push(dist);
    totalLength += dist;
  }

  if (totalLength === 0) return path[0];

  const targetDist = totalLength / 2;
  let currentDist = 0;
  for (let i = 0; i < segmentLengths.length; i++) {
    const len = segmentLengths[i];
    if (currentDist + len >= targetDist) {
      const remaining = targetDist - currentDist;
      const ratio = len > 0 ? remaining / len : 0;
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * ratio,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * ratio,
      };
    }
    currentDist += len;
  }

  return path[Math.floor(path.length / 2)];
}
