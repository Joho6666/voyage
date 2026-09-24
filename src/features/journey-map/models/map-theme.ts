import type { MapTheme } from "./map-state";

export interface BasemapConfig {
  mapStyle: string;
  features: string[];
  backgroundColor: string;
}

export const BASEMAP_THEMES: Record<MapTheme, BasemapConfig> = {
  light: {
    // whitesmoke is AMap's official calm, low-saturation, clean style
    mapStyle: "amap://styles/whitesmoke",
    // Keep roads, rivers/water (bg), subtle buildings, minimize commercial point clutter
    features: ["bg", "road", "building"],
    backgroundColor: "#f5f6f8",
  },
  dark: {
    mapStyle: "amap://styles/dark",
    features: ["bg", "road", "building"],
    backgroundColor: "#18181b",
  },
};

export function getBasemapConfig(theme: MapTheme = "light"): BasemapConfig {
  return BASEMAP_THEMES[theme] || BASEMAP_THEMES.light;
}
