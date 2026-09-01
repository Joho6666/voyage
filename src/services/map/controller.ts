import { DAY_COLORS } from "@/types/travel";
import type { Place, Trip } from "@/types/travel";
import type { MapFilter } from "@/store/ui-store";
import type { MapMarker, MapPolyline, MapRenderModel } from "./types";

export function buildMapModel(
  trip: Trip,
  opts: {
    selectedId: string | null;
    hoverId: string | null;
    filters: MapFilter[];
    search: string;
    activeDayId: string | null;
  },
): MapRenderModel {
  const q = opts.search.trim().toLowerCase();
  const itineraryPlaceIds = new Set(trip.items.map((i) => i.placeId));

  const markers: MapMarker[] = [];

  trip.days.forEach((day) => {
    const items = trip.items
      .filter((i) => i.dayId === day.id)
      .sort((a, b) => a.order - b.order);
    items.forEach((item, index) => {
      const place = trip.places.find((p) => p.id === item.placeId);
      if (!place) return;
      markers.push({
        id: place.id,
        lat: place.lat,
        lng: place.lng,
        title: place.name,
        number: index + 1,
        kind: place.category,
        dayIndex: day.index,
        selected: opts.selectedId === place.id,
        image: place.image,
        rating: place.rating,
        priceLabel: place.priceLabel,
      });
    });
  });

  const extra = trip.places.filter((p) => {
    if (itineraryPlaceIds.has(p.id)) return false;
    if (opts.filters.length && !opts.filters.includes(p.category as MapFilter)) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.district.includes(q)) return false;
    return true;
  });

  extra.forEach((place) => {
    markers.push(placeToMarker(place, opts.selectedId === place.id));
  });

  const polylines: MapPolyline[] = trip.days.map((day) => {
    const items = trip.items
      .filter((i) => i.dayId === day.id)
      .sort((a, b) => a.order - b.order);
    const path = items
      .map((i) => trip.places.find((p) => p.id === i.placeId))
      .filter((p): p is Place => Boolean(p))
      .map((p) => ({ lat: p.lat, lng: p.lng }));
    return {
      id: `line-${day.id}`,
      dayIndex: day.index,
      color: DAY_COLORS[day.index % DAY_COLORS.length],
      path,
    };
  });

  return {
    markers,
    polylines: opts.activeDayId
      ? polylines.map((line) =>
          line.id === `line-${opts.activeDayId}` ? line : { ...line, color: `${line.color}55` },
        )
      : polylines,
    selectedId: opts.selectedId,
    hoverId: opts.hoverId,
  };
}

function placeToMarker(place: Place, selected: boolean): MapMarker {
  return {
    id: place.id,
    lat: place.lat,
    lng: place.lng,
    title: place.name,
    kind: place.category,
    selected,
    image: place.image,
    rating: place.rating,
    priceLabel: place.priceLabel,
  };
}
