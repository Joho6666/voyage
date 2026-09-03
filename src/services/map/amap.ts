import type { MapProvider } from "./types";

export class AMapProvider implements MapProvider {
  readonly id = "amap" as const;
  readonly label = "AMap";

  static isConfigured() {
    return Boolean(process.env.NEXT_PUBLIC_AMAP_KEY || process.env.AMAP_SERVER_KEY);
  }
}

export function createMapProvider(): MapProvider {
  if (AMapProvider.isConfigured()) return new AMapProvider();
  return { id: "mock", label: "Mock Map" };
}
