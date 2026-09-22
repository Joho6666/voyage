import { estimateTransit, haversineMeters, uid } from "@/lib/utils";
import type { ItineraryItem, Place, RouteSegment, RouteStep, Trip } from "@/types/travel";

function placeOf(trip: Trip, placeId: string): Place | undefined {
  return trip.places.find((p) => p.id === placeId);
}

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function visibleItems(items: ItineraryItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

/**
 * Fast synchronous day recomputation using Haversine heuristics.
 * Preserves previously resolved real AMap segment routes if the origin & destination place pairs haven't changed.
 */
export function recomputeDay(trip: Trip, dayId: string): Trip {
  const items = visibleItems(trip.items.filter((i) => i.dayId === dayId));
  const others = trip.items.filter((i) => i.dayId !== dayId);
  const existingSegments = trip.segments.filter((s) => s.dayId === dayId);
  const start = items[0]?.startTime || "09:00";
  let cursor = start;

  const nextItems: ItineraryItem[] = items.map((item, index) => {
    const updated = {
      ...item,
      order: index,
      startTime: cursor,
      duration: item.duration || placeOf(trip, item.placeId)?.stayMinutes || 60,
    };
    cursor = addMinutes(updated.startTime, updated.duration);
    updated.endTime = cursor;
    const following = items[index + 1];
    if (following) {
      const a = placeOf(trip, item.placeId);
      const b = placeOf(trip, following.placeId);
      if (a && b) {
        // Check if we have an existing real segment
        const existing = existingSegments.find(
          (s) => s.fromItemId === item.id && s.toItemId === following.id && s.fromPlaceId === a.id && s.toPlaceId === b.id,
        );
        const transitMinutes = existing?.durationMinutes ?? estimateTransit(haversineMeters(a, b)).minutes;
        cursor = addMinutes(cursor, transitMinutes);
      }
    }
    return updated;
  });

  const nextSegments: RouteSegment[] = [];
  for (let i = 0; i < nextItems.length - 1; i += 1) {
    const from = nextItems[i];
    const to = nextItems[i + 1];
    const a = placeOf(trip, from.placeId);
    const b = placeOf(trip, to.placeId);
    if (!a || !b) continue;

    // Reuse existing real route segment if place pair matches
    const existing = existingSegments.find(
      (s) => s.fromPlaceId === a.id && s.toPlaceId === b.id && s.provider === "amap" && !s.estimated,
    );

    if (existing) {
      nextSegments.push({
        ...existing,
        id: existing.id || uid("seg"),
        dayId,
        fromItemId: from.id,
        toItemId: to.id,
      });
      continue;
    }

    const meters = haversineMeters(a, b);
    const transit = estimateTransit(meters);
    nextSegments.push({
      id: uid("seg"),
      tripId: trip.id,
      dayId,
      fromItemId: from.id,
      toItemId: to.id,
      fromPlaceId: a.id,
      toPlaceId: b.id,
      mode: transit.mode,
      distanceMeters: meters,
      durationMinutes: transit.minutes,
      meters,
      minutes: transit.minutes,
      label: transit.label,
      polyline: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
      steps: [
        {
          instruction: `沿途从起点前往终点（${transit.label}，直线预估距离）`,
          distanceMeters: meters,
          durationMinutes: transit.minutes,
          polyline: [
            [a.lng, a.lat],
            [b.lng, b.lat],
          ],
        },
      ],
      provider: "haversine",
      estimated: true,
      provenance: { source: "haversine", estimated: true },
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    ...trip,
    items: [...others, ...nextItems],
    segments: [...trip.segments.filter((s) => s.dayId !== dayId), ...nextSegments],
  };
}

export function recomputeTrip(trip: Trip): Trip {
  return trip.days.reduce((acc, day) => recomputeDay(acc, day.id), trip);
}

export interface RouteApiResult {
  source: "amap" | "haversine";
  estimated: boolean;
  mode: "walk" | "metro" | "bus" | "taxi" | "drive";
  distanceMeters: number;
  durationMinutes: number;
  polyline: Array<[number, number]>;
  steps?: RouteStep[];
}

/**
 * Fetch real multi-modal navigation route from the server-side AMap route API.
 */
export async function fetchRealRoute(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
  mode: "walk" | "metro" | "bus" | "taxi" | "drive" = "walk",
  city: string = "重庆",
): Promise<RouteApiResult> {
  try {
    const response = await fetch("/api/amap/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination, mode, city }),
    });
    if (!response.ok) throw new Error(`Route API returned ${response.status}`);
    return (await response.json()) as RouteApiResult;
  } catch {
    // Graceful fallback
    const meters = haversineMeters(origin, destination);
    const transit = estimateTransit(meters);
    return {
      source: "haversine",
      estimated: true,
      mode: mode === "drive" ? "taxi" : mode,
      distanceMeters: meters,
      durationMinutes: transit.minutes,
      polyline: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat],
      ],
    };
  }
}

function toRouteMode(mode: string): "walk" | "metro" | "bus" | "taxi" | "drive" {
  if (mode === "flight" || mode === "highspeed" || mode === "taxi") return "taxi";
  if (mode === "bus" || mode === "metro") return mode;
  if (mode === "drive") return "drive";
  return "walk";
}

/**
 * Asynchronously recomputes all segments of a given day using real AMap direction APIs.
 */
export async function recomputeDayWithRealRoutes(trip: Trip, dayId: string): Promise<Trip> {
  // First ensure synchronous items order and baseline
  const baseTrip = recomputeDay(trip, dayId);
  const items = visibleItems(baseTrip.items.filter((i) => i.dayId === dayId));
  const segments = baseTrip.segments.filter((s) => s.dayId === dayId);
  if (items.length < 2) return baseTrip;

  const resolvedSegments: RouteSegment[] = [];
  for (const seg of segments) {
    const fromPlace = placeOf(baseTrip, seg.fromPlaceId);
    const toPlace = placeOf(baseTrip, seg.toPlaceId);
    if (!fromPlace || !toPlace) {
      resolvedSegments.push(seg);
      continue;
    }

    // Call real route API
    const realRoute = await fetchRealRoute(
      { lng: fromPlace.lng, lat: fromPlace.lat },
      { lng: toPlace.lng, lat: toPlace.lat },
      toRouteMode(seg.mode),
      baseTrip.destination || "重庆",
    );

    resolvedSegments.push({
      ...seg,
      distanceMeters: realRoute.distanceMeters,
      durationMinutes: realRoute.durationMinutes,
      meters: realRoute.distanceMeters,
      minutes: realRoute.durationMinutes,
      polyline: realRoute.polyline,
      steps: realRoute.steps,
      provider: realRoute.source,
      estimated: realRoute.estimated,
      provenance: realRoute.estimated
        ? { source: "haversine", estimated: true }
        : { source: "amap", estimated: false },
      updatedAt: new Date().toISOString(),
    });
  }

  // Re-adjust item start & end times based on real transit minutes
  let cursor = items[0]?.startTime || "09:00";
  const updatedItems: ItineraryItem[] = items.map((item, index) => {
    const updated = {
      ...item,
      startTime: cursor,
      duration: item.duration || placeOf(baseTrip, item.placeId)?.stayMinutes || 60,
    };
    cursor = addMinutes(updated.startTime, updated.duration);
    updated.endTime = cursor;
    const seg = resolvedSegments[index];
    if (seg) {
      cursor = addMinutes(cursor, seg.durationMinutes);
    }
    return updated;
  });

  const otherItems = baseTrip.items.filter((i) => i.dayId !== dayId);
  const otherSegments = baseTrip.segments.filter((s) => s.dayId !== dayId);

  return {
    ...baseTrip,
    items: [...otherItems, ...updatedItems],
    segments: [...otherSegments, ...resolvedSegments],
  };
}

export async function recomputeTripWithRealRoutes(trip: Trip): Promise<Trip> {
  let next = trip;
  for (const day of trip.days) {
    next = await recomputeDayWithRealRoutes(next, day.id);
  }
  return next;
}

export function dayStats(trip: Trip, dayId: string) {
  const items = visibleItems(trip.items.filter((i) => i.dayId === dayId && i.type !== "note"));
  const segments = trip.segments.filter((s) => s.dayId === dayId);
  const walkMin = segments.filter((s) => s.mode === "walk").reduce((n, s) => n + s.minutes, 0);
  const metroMin = segments.filter((s) => s.mode === "metro").reduce((n, s) => n + s.minutes, 0);
  const taxiMin = segments.filter((s) => s.mode === "taxi").reduce((n, s) => n + s.minutes, 0);
  const meters = segments.reduce((n, s) => n + (s.distanceMeters || s.meters || 0), 0);
  const realCount = segments.filter((s) => !s.estimated && s.provider === "amap").length;
  return {
    places: items.length,
    meters,
    walkMin,
    metroMin,
    taxiMin,
    realCount,
    estimatedCount: segments.length - realCount,
  };
}
