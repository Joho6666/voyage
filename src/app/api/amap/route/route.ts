import { NextResponse } from "next/server";
import {
  isAmapConfigured,
  amapWalkingRoute,
  amapDrivingRoute,
  amapTransitRoute,
} from "@/services/map/amap-rest";
import { haversineMeters, estimateTransit } from "@/lib/utils";

interface RouteQuery {
  origin: { lng: number; lat: number };
  destination: { lng: number; lat: number };
  mode?: "walk" | "metro" | "bus" | "taxi" | "drive";
  city?: string;
}

// In-memory LRU-like cache for route responses to avoid burning AMap API quota
const routeCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

function getCacheKey(q: RouteQuery): string {
  const o = `${q.origin.lng.toFixed(5)},${q.origin.lat.toFixed(5)}`;
  const d = `${q.destination.lng.toFixed(5)},${q.destination.lat.toFixed(5)}`;
  return `${q.mode ?? "auto"}:${o}->${d}:${q.city ?? ""}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<RouteQuery>;
    const { origin, destination, mode = "walk", city = "重庆" } = body;

    if (
      !origin ||
      !destination ||
      typeof origin.lng !== "number" ||
      typeof origin.lat !== "number" ||
      typeof destination.lng !== "number" ||
      typeof destination.lat !== "number"
    ) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }

    const cacheKey = getCacheKey({ origin, destination, mode, city });
    const cached = routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    if (isAmapConfigured()) {
      try {
        let result;
        if (mode === "walk") {
          result = await amapWalkingRoute(origin, destination);
        } else if (mode === "taxi" || mode === "drive") {
          result = await amapDrivingRoute(origin, destination);
        } else if (mode === "metro" || mode === "bus") {
          // Do not relabel a driving/walking fallback as an authoritative transit route.
          result = await amapTransitRoute(origin, destination, city);
        } else {
          result = await amapWalkingRoute(origin, destination);
        }

        const payload = {
          source: "amap",
          estimated: false,
          mode,
          distanceMeters: result.distanceMeters,
          durationMinutes: result.durationMinutes,
          polyline: result.polyline,
          steps: result.steps,
        };
        routeCache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
        return NextResponse.json(payload);
      } catch (err) {
        console.warn("AMap route API error, falling back to haversine estimation:", err);
      }
    }

    // Fallback: Haversine estimation
    const meters = haversineMeters(origin, destination);
    const transit = estimateTransit(meters);
    const fallbackPayload = {
      source: "haversine",
      estimated: true,
      mode: mode === "drive" ? "taxi" : mode,
      distanceMeters: meters,
      durationMinutes: transit.minutes,
      polyline: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat],
      ],
      steps: [
        {
          instruction: `沿途从起点前往终点（${transit.label}，直线预估距离）`,
          distanceMeters: meters,
          durationMinutes: transit.minutes,
          polyline: [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat],
          ],
        },
      ],
    };

    routeCache.set(cacheKey, { data: fallbackPayload, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(fallbackPayload);
  } catch (error) {
    console.error("Route calculation error:", error);
    return NextResponse.json({ error: "Failed to calculate route" }, { status: 500 });
  }
}
