export type MapMode = "PLAN" | "TODAY" | "EXPLORE";
export type MapTheme = "light" | "dark";

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  updatedAt: number;
}

export interface MapLayersConfig {
  trip: boolean;
  explore: boolean;
  hotel: boolean;
  food: boolean;
  transport: boolean;
}

export const DEFAULT_LAYERS: Record<MapMode, MapLayersConfig> = {
  PLAN: {
    trip: true,
    explore: false,
    hotel: true,
    food: false,
    transport: true,
  },
  TODAY: {
    trip: true,
    explore: false,
    hotel: false,
    food: false,
    transport: true,
  },
  EXPLORE: {
    trip: true,
    explore: true,
    hotel: true,
    food: true,
    transport: true,
  },
};

export type ZoomDensityTier = "low" | "mid" | "high";

/**
 * Zoom Density:
 * - low (< 11): only Trip Route, Day core area, Hotel
 * - mid (11 <= zoom < 14): Trip POI, Route, Metro / Transport
 * - high (>= 14): Explore POI, Food, Cafe, Route Badge, Detailed Labels
 */
export function getZoomDensityTier(zoom: number): ZoomDensityTier {
  if (zoom < 11) return "low";
  if (zoom < 14) return "mid";
  return "high";
}
