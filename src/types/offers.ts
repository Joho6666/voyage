export type OfferKind = "hotel" | "flight" | "train" | "ticket" | "restaurant" | "coupon";
export type OfferProvider = "amap" | "fliggy" | "meituan";

export type OfferAvailability = "available" | "unknown" | "unavailable";

export interface TravelOffer {
  id: string;
  kind: OfferKind;
  title: string;
  imageUrl?: string;
  provider: OfferProvider;
  city?: string;
  origin?: string;
  destination?: string;
  date?: string;
  departureTime?: string;
  arrivalTime?: string;
  checkIn?: string;
  checkOut?: string;
  priceLabel?: string;
  availability?: OfferAvailability;
  inventoryLabel?: string;
  ratingLabel?: string;
  description?: string;
  bookingUrl?: string;
  sourceId?: string;
  fetchedAt: string;
  structured: boolean;
  rawText?: string;
  rawJson?: unknown;
}

export type OfferProviderLevel = "REAL" | "UNAVAILABLE" | "UNKNOWN" | "UNSTRUCTURED" | "ESTIMATED" | "PERMISSION_REQUIRED";

export interface OfferProviderStatus {
  overall: OfferProviderLevel;
  hotel?: OfferProviderLevel;
  train?: OfferProviderLevel;
  flight?: OfferProviderLevel;
  ticket?: OfferProviderLevel;
  restaurant?: OfferProviderLevel;
  coupon?: OfferProviderLevel;
  weather?: OfferProviderLevel;
  fetchedAt?: string;
  warnings?: string[];
}
