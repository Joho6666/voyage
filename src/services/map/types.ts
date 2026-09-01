import type { GeoPoint, PlaceCategory } from "@/types/travel";

export type MapProviderId = "mock" | "amap" | "google" | "mapbox";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  number?: number;
  kind: PlaceCategory | "current";
  dayIndex?: number;
  selected?: boolean;
  image?: string;
  rating?: number;
  priceLabel?: string;
}

export interface MapPolyline {
  id: string;
  dayIndex: number;
  color: string;
  path: GeoPoint[];
}

export interface MapViewState {
  center: GeoPoint;
  zoom: number;
}

export interface MapRenderModel {
  markers: MapMarker[];
  polylines: MapPolyline[];
  selectedId: string | null;
  hoverId: string | null;
}

export interface MapProvider {
  readonly id: MapProviderId;
  readonly label: string;
}
