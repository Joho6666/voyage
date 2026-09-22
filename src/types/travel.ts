export type PlaceCategory =
  | "attraction"
  | "food"
  | "cafe"
  | "hotel"
  | "activity"
  | "shopping"
  | "transport"
  | "viewpoint";

export type ItineraryItemType =
  | "place"
  | "food"
  | "hotel"
  | "activity"
  | "transport"
  | "note";

export type ItemStatus = "planned" | "current" | "done" | "skipped";
export type TaskStatus = "todo" | "done";
export type BudgetCategory = "transport" | "stay" | "food" | "ticket" | "shop" | "other";
export type TransportKind = "highspeed" | "flight" | "metro" | "walk" | "taxi" | "bus" | "drive";
export type OpeningStatus = "open" | "closed" | "unknown";

export type DataProvenance =
  | { source: "amap"; estimated: false }
  | { source: "haversine" | "demo"; estimated: true }
  | { source: "unavailable"; estimated: true; reason: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface VerticalInfo {
  floor?: string;
  levelDescription?: string;
  elevationDiffMeters?: number;
  elevatorHint?: string;
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  image: string;
  priceLevel: 0 | 1 | 2 | 3 | 4;
  priceLabel?: string;
  address: string;
  openingHours?: string;
  openingStatus: OpeningStatus;
  stayMinutes: number;
  description: string;
  tags: string[];
  district: string;
  estimatedCost?: number;
  source?: "amap" | "demo" | "llm" | "user";
  sourceId?: string;
  provenance?: DataProvenance;
  vertical?: VerticalInfo;
}

export interface Day {
  id: string;
  tripId: string;
  index: number;
  date: string;
  title: string;
  summary: string;
  weather: {
    tempC: number;
    condition: string;
    icon: "sun" | "cloud" | "rain" | "overcast";
    provenance?: DataProvenance;
    fetchedAt?: string;
  };
}

export interface ItineraryItem {
  id: string;
  dayId: string;
  type: ItineraryItemType;
  placeId: string;
  startTime: string;
  endTime?: string;
  duration: number;
  order: number;
  status: ItemStatus;
  notes?: string;
  meal?: "breakfast" | "lunch" | "dinner" | "snack";
  reservationId?: string;
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationMinutes: number;
  polyline?: Array<[number, number]>;
  verticalHint?: string;
  floorTransition?: {
    fromFloor: string;
    toFloor: string;
    mode: "elevator" | "escalator" | "stairs" | "walkway";
  };
}

export interface RouteSegment {
  id: string;
  tripId?: string;
  dayId: string;
  fromItemId: string;
  toItemId: string;
  fromPlaceId: string;
  toPlaceId: string;
  mode: TransportKind;
  distanceMeters: number;
  durationMinutes: number;
  /** Backwards-compatible alias for distanceMeters */
  meters: number;
  /** Backwards-compatible alias for durationMinutes */
  minutes: number;
  label: string;
  polyline?: Array<[number, number]>;
  steps?: RouteStep[];
  provider: "amap" | "haversine" | "mock";
  providerRouteId?: string;
  estimated: boolean;
  estimatedCost?: number;
  updatedAt: string;
  provenance?: DataProvenance;
}

export interface Hotel {
  id: string;
  placeId: string;
  name: string;
  rating: number;
  reviewCount: number;
  image: string;
  district: string;
  pricePerNight: number;
  tags: string[];
  insight: string;
  bookingUrl: string;
  distanceToCenterKm: number;
}

export interface Restaurant {
  id: string;
  placeId: string;
  cuisine: string;
  signature: string;
  avgSpend: number;
  why: string;
  mealFit: Array<"breakfast" | "lunch" | "dinner" | "night">;
}

export interface Activity {
  id: string;
  placeId: string;
  name: string;
  banner: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  price: number;
  remaining?: string;
  insight: string;
}

export interface Transport {
  id: string;
  kind: TransportKind;
  fromCity: string;
  toCity: string;
  fromStation: string;
  toStation: string;
  departTime: string;
  arriveTime: string;
  durationLabel: string;
  price: number;
  date: string;
}

export interface Task {
  id: string;
  tripId: string;
  dayId?: string;
  placeId?: string;
  title: string;
  group: "before" | "day";
  status: TaskStatus;
  checkin?: boolean;
  dueAt?: string;
  linkedItemId?: string;
}

export interface BudgetItem {
  id: string;
  tripId: string;
  category: BudgetCategory;
  label: string;
  planned: number;
  actual?: number;
}

export interface Booking {
  id: string;
  tripId: string;
  kind: "hotel" | "ticket" | "activity";
  title: string;
  provider: string;
  url: string;
  status: "idle" | "opened" | "confirmed" | "cancelled";
  externalUrl?: string;
  reference?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarInitials: string;
}

export type TripStatus = "draft" | "ready" | "traveling" | "done";

export interface Trip {
  id: string;
  ownerId?: string;
  title: string;
  destination: string;
  origin: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  currency?: string;
  status?: TripStatus;
  estimatedSpend: number;
  coverImage: string;
  vibe: string[];
  prompt: string;
  createdAt?: string;
  updatedAt?: string;
  days: Day[];
  items: ItineraryItem[];
  segments: RouteSegment[];
  places: Place[];
  hotels: Hotel[];
  restaurants: Restaurant[];
  activities: Activity[];
  transports: Transport[];
  tasks: Task[];
  budgetItems: BudgetItem[];
}

export interface TripSummary {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  coverImage: string;
  status: TripStatus;
  createdAt?: string;
}

export const PLACE_CATEGORY_LABEL: Record<PlaceCategory, string> = {
  attraction: "景点",
  food: "美食",
  cafe: "咖啡",
  hotel: "酒店",
  activity: "活动",
  shopping: "购物",
  transport: "交通",
  viewpoint: "观景",
};

export const DAY_COLORS = ["#0F766E", "#C2410C", "#1D4ED8", "#7C3AED", "#B45309"] as const;
