import type { Place, PlaceCategory, VerticalInfo } from "@/types/travel";

export type MarkerVariant =
  | "DEFAULT"
  | "HOVERED"
  | "SELECTED"
  | "NEXT"
  | "COMPLETED"
  | "HOTEL"
  | "FOOD"
  | "TRANSPORT"
  | "EXPLORE";

export interface JourneyMarker {
  id: string;
  placeId: string;
  lat: number;
  lng: number;
  title: string;
  variant: MarkerVariant;
  number?: number;
  time?: string;
  duration?: number;
  dayId?: string;
  dayIndex?: number;
  category: PlaceCategory | "transport";
  color: string;
  isNext?: boolean;
  isCompleted?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
  rating?: number;
  priceLabel?: string;
  image?: string;
  tags?: string[];
  nextEtaMinutes?: number;
  vertical?: VerticalInfo;
}

export interface MarkerClusterGroup {
  id: string;
  lat: number;
  lng: number;
  count: number;
  places: Place[];
}
