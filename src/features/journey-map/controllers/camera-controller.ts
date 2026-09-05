import type { GeoPoint, Place, Trip } from "@/types/travel";
import type { AMapInstance } from "@/services/map/amap-js";
import type { UserLocation } from "../models/map-state";

export interface CameraBounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  center: GeoPoint;
}

export function computeBounds(points: GeoPoint[]): CameraBounds | null {
  if (!points.length) return null;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    center: {
      lng: (minLng + maxLng) / 2,
      lat: (minLat + maxLat) / 2,
    },
  };
}

export function getTripPoints(trip: Trip): GeoPoint[] {
  return trip.places.map((p) => ({ lat: p.lat, lng: p.lng }));
}

export function getDayPoints(trip: Trip, dayId: string): GeoPoint[] {
  const dayItemPlaceIds = new Set(
    trip.items.filter((i) => i.dayId === dayId).map((i) => i.placeId),
  );
  const places = trip.places.filter((p) => dayItemPlaceIds.has(p.id));
  return places.map((p) => ({ lat: p.lat, lng: p.lng }));
}

export class MapCameraController {
  private map: AMapInstance | null = null;
  private userInteracted = false;
  private onCameraChangeCallback?: () => void;

  setMap(map: AMapInstance | null) {
    this.map = map;
  }

  setUserInteracted(interacted: boolean) {
    this.userInteracted = interacted;
    this.onCameraChangeCallback?.();
  }

  isUserInteracted(): boolean {
    return this.userInteracted;
  }

  subscribe(callback: () => void) {
    this.onCameraChangeCallback = callback;
    return () => {
      this.onCameraChangeCallback = undefined;
    };
  }

  fitTrip(trip: Trip, force: boolean = false) {
    if (!this.map) return;
    if (this.userInteracted && !force) return;

    const points = getTripPoints(trip);
    if (!points.length) return;

    const bounds = computeBounds(points);
    if (!bounds) return;

    this.panAndZoomToBounds(bounds);
    this.userInteracted = false;
    this.onCameraChangeCallback?.();
  }

  fitDay(trip: Trip, dayId: string, force: boolean = false) {
    if (!this.map) return;
    if (this.userInteracted && !force) return;

    const points = getDayPoints(trip, dayId);
    if (!points.length) {
      this.fitTrip(trip, force);
      return;
    }

    const bounds = computeBounds(points);
    if (!bounds) return;

    this.panAndZoomToBounds(bounds);
    this.userInteracted = false;
    this.onCameraChangeCallback?.();
  }

  flyToPlace(place: Place) {
    if (!this.map) return;
    this.map.panTo([place.lng, place.lat]);
    this.map.setZoom(15);
  }

  focusRoute(path: GeoPoint[]) {
    if (!this.map || path.length < 2) return;
    const bounds = computeBounds(path);
    if (!bounds) return;
    this.panAndZoomToBounds(bounds);
  }

  focusCurrentLocation(location: UserLocation) {
    if (!this.map) return;
    this.map.panTo([location.lng, location.lat]);
    this.map.setZoom(15);
  }

  reset(trip: Trip, activeDayId: string | null) {
    this.userInteracted = false;
    if (activeDayId) {
      this.fitDay(trip, activeDayId, true);
    } else {
      this.fitTrip(trip, true);
    }
  }

  private panAndZoomToBounds(bounds: CameraBounds) {
    if (!this.map) return;
    const dLng = bounds.maxLng - bounds.minLng;
    const dLat = bounds.maxLat - bounds.minLat;
    const maxDelta = Math.max(dLng, dLat);

    let zoom = 13;
    if (maxDelta > 0.5) zoom = 10;
    else if (maxDelta > 0.2) zoom = 11;
    else if (maxDelta > 0.08) zoom = 12;
    else if (maxDelta > 0.04) zoom = 13;
    else if (maxDelta > 0.015) zoom = 14;
    else zoom = 15;

    this.map.panTo([bounds.center.lng, bounds.center.lat]);
    this.map.setZoom(zoom);
  }
}
