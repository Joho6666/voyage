import type { GeoPoint } from "@/types/travel";

const BOUNDS = {
  minLng: 106.42,
  maxLng: 106.62,
  minLat: 29.52,
  maxLat: 29.64,
};

export function project(point: GeoPoint, width: number, height: number, pad = 28) {
  const x =
    pad +
    ((point.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * (width - pad * 2);
  const y =
    pad +
    (1 - (point.lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * (height - pad * 2);
  return { x, y };
}

export function unproject(x: number, y: number, width: number, height: number, pad = 28) {
  const lng =
    BOUNDS.minLng + ((x - pad) / (width - pad * 2)) * (BOUNDS.maxLng - BOUNDS.minLng);
  const lat =
    BOUNDS.minLat + (1 - (y - pad) / (height - pad * 2)) * (BOUNDS.maxLat - BOUNDS.minLat);
  return { lat, lng };
}

export { BOUNDS };
