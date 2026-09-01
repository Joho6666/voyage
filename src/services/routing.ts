import { estimateTransit, haversineMeters, uid } from "@/lib/utils";
import type { ItineraryItem, Place, RouteSegment, Trip } from "@/types/travel";

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

export function recomputeDay(trip: Trip, dayId: string): Trip {
  const items = visibleItems(trip.items.filter((i) => i.dayId === dayId));
  const others = trip.items.filter((i) => i.dayId !== dayId);
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
    const following = items[index + 1];
    if (following) {
      const a = placeOf(trip, item.placeId);
      const b = placeOf(trip, following.placeId);
      if (a && b) {
        const meters = haversineMeters(a, b);
        cursor = addMinutes(cursor, estimateTransit(meters).minutes);
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
    const meters = haversineMeters(a, b);
    const transit = estimateTransit(meters);
    nextSegments.push({
      id: uid("seg"),
      dayId,
      fromItemId: from.id,
      toItemId: to.id,
      mode: transit.mode,
      meters,
      minutes: transit.minutes,
      label: transit.label,
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

export function dayStats(trip: Trip, dayId: string) {
  const items = visibleItems(trip.items.filter((i) => i.dayId === dayId && i.type !== "note"));
  const segments = trip.segments.filter((s) => s.dayId === dayId);
  const walkMin = segments.filter((s) => s.mode === "walk").reduce((n, s) => n + s.minutes, 0);
  const metroMin = segments.filter((s) => s.mode === "metro").reduce((n, s) => n + s.minutes, 0);
  const taxiMin = segments.filter((s) => s.mode === "taxi").reduce((n, s) => n + s.minutes, 0);
  const meters = segments.reduce((n, s) => n + s.meters, 0);
  return {
    places: items.length,
    meters,
    walkMin,
    metroMin,
    taxiMin,
  };
}
