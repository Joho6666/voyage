import { DAY_COLORS, type Place, type Trip } from "@/types/travel";
import type { JourneyMarker, MarkerClusterGroup, MarkerVariant } from "../models/marker-model";
import type { MapLayersConfig, MapMode } from "../models/map-state";

export interface BuildMarkersOptions {
  activeDayId: string | null;
  selectedPlaceId: string | null;
  hoverPlaceId: string | null;
  mapMode: MapMode;
  layers?: MapLayersConfig;
  search?: string;
  zoom?: number;
}

export function buildJourneyMarkers(trip: Trip, options: BuildMarkersOptions): JourneyMarker[] {
  const {
    activeDayId,
    selectedPlaceId,
    hoverPlaceId,
    mapMode,
    layers = { trip: true, explore: false, hotel: true, food: false, transport: true },
    search = "",
  } = options;

  const q = search.trim().toLowerCase();
  const markers: JourneyMarker[] = [];
  const itineraryPlaceIds = new Set<string>();

  // Determine current day for Today mode
  const currentDayId = activeDayId ?? trip.days[0]?.id;
  const currentDayItems = trip.items
    .filter((i) => i.dayId === currentDayId)
    .sort((a, b) => a.order - b.order);

  // Find next stop in Today mode
  const nextItemIndex = currentDayItems.findIndex((i) => i.status !== "done");
  const nextItemId = nextItemIndex >= 0 ? currentDayItems[nextItemIndex]?.id : null;

  // 1. Process Itinerary Items
  trip.days.forEach((day) => {
    const isDayActive = !activeDayId || activeDayId === day.id;
    // If we're in TODAY mode, we only focus on the active day's itinerary unless explicitly viewing all
    if (mapMode === "TODAY" && activeDayId && day.id !== activeDayId) {
      return;
    }

    const dayColor = DAY_COLORS[day.index % DAY_COLORS.length];
    const items = trip.items
      .filter((i) => i.dayId === day.id)
      .sort((a, b) => a.order - b.order);

    items.forEach((item, index) => {
      const place = trip.places.find((p) => p.id === item.placeId);
      if (!place) return;
      itineraryPlaceIds.add(place.id);

      if (q && !place.name.toLowerCase().includes(q) && !place.district.toLowerCase().includes(q)) {
        return;
      }

      const isSelected = selectedPlaceId === place.id;
      const isHovered = hoverPlaceId === place.id;
      const isCompleted = item.status === "done";
      const isNext = mapMode === "TODAY" && item.id === nextItemId && !isCompleted;

      // Determine variant
      let variant: MarkerVariant = "DEFAULT";
      if (isSelected) {
        variant = "SELECTED";
      } else if (isHovered) {
        variant = "HOVERED";
      } else if (isNext) {
        variant = "NEXT";
      } else if (isCompleted) {
        variant = "COMPLETED";
      } else if (place.category === "hotel") {
        variant = "HOTEL";
      } else if (place.category === "food") {
        variant = "FOOD";
      } else if (place.category === "transport") {
        variant = "TRANSPORT";
      }

      // If day is not active, slightly adjust color/opacity indication
      const markerColor = isDayActive ? dayColor : `${dayColor}88`;

      markers.push({
        id: `itinerary-marker-${item.id}`,
        placeId: place.id,
        lat: place.lat,
        lng: place.lng,
        title: place.name,
        variant,
        number: index + 1,
        time: item.startTime,
        duration: item.duration,
        dayId: day.id,
        dayIndex: day.index,
        category: place.category,
        color: markerColor,
        isNext,
        isCompleted,
        isSelected,
        isHovered,
        rating: place.rating,
        priceLabel: place.priceLabel,
        image: place.image,
        tags: place.tags,
        vertical: place.vertical,
      });
    });
  });

  // 2. Extra Places (Hotels, Transports, Food, Explore POIs)
  const extraPlaces = trip.places.filter((p) => !itineraryPlaceIds.has(p.id));

  extraPlaces.forEach((place) => {
    if (q && !place.name.toLowerCase().includes(q) && !place.district.toLowerCase().includes(q)) {
      return;
    }

    // Layer visibility filter
    if (place.category === "hotel" && !layers.hotel) return;
    if (place.category === "transport" && !layers.transport) return;
    if (place.category === "food" && !layers.food && mapMode !== "EXPLORE") return;
    if (mapMode === "PLAN" && !layers.explore && !["hotel", "transport"].includes(place.category)) return;

    const isSelected = selectedPlaceId === place.id;
    const isHovered = hoverPlaceId === place.id;

    let variant: MarkerVariant = "EXPLORE";
    if (isSelected) {
      variant = "SELECTED";
    } else if (isHovered) {
      variant = "HOVERED";
    } else if (place.category === "hotel") {
      variant = "HOTEL";
    } else if (place.category === "food" || place.category === "cafe") {
      variant = "FOOD";
    } else if (place.category === "transport") {
      variant = "TRANSPORT";
    }

    const categoryColor =
      place.category === "hotel"
        ? "#2563EB"
        : place.category === "food" || place.category === "cafe"
          ? "#EA580C"
          : place.category === "transport"
            ? "#0D9488"
            : "#6366F1";

    markers.push({
      id: `place-marker-${place.id}`,
      placeId: place.id,
      lat: place.lat,
      lng: place.lng,
      title: place.name,
      variant,
      category: place.category,
      color: categoryColor,
      isSelected,
      isHovered,
      rating: place.rating,
      priceLabel: place.priceLabel,
      image: place.image,
      tags: place.tags,
      vertical: place.vertical,
    });
  });

  return markers;
}

/**
 * Cluster places when zoom < 14 and number of POIs is large in Explore mode.
 */
export function clusterExplorePlaces(
  places: Place[],
  gridSize: number = 0.02,
): MarkerClusterGroup[] {
  const clusters: Map<string, Place[]> = new Map();

  places.forEach((p) => {
    const gridX = Math.floor(p.lng / gridSize);
    const gridY = Math.floor(p.lat / gridSize);
    const key = `${gridX}:${gridY}`;
    const group = clusters.get(key) || [];
    group.push(p);
    clusters.set(key, group);
  });

  const result: MarkerClusterGroup[] = [];
  clusters.forEach((items, key) => {
    const avgLat = items.reduce((sum, p) => sum + p.lat, 0) / items.length;
    const avgLng = items.reduce((sum, p) => sum + p.lng, 0) / items.length;
    result.push({
      id: `cluster-${key}`,
      lat: avgLat,
      lng: avgLng,
      count: items.length,
      places: items,
    });
  });

  return result;
}
