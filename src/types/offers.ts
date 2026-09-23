export type OfferKind = "hotel" | "flight" | "train" | "ticket" | "restaurant" | "coupon";

export type OfferAvailability = "available" | "unknown" | "unavailable";

export interface TravelOffer {
  id: string;
  kind: OfferKind;
  title: string;
  provider: "meituan";
  city?: string;
  origin?: string;
  destination?: string;
  date?: string;
  priceLabel?: string;
  availability?: OfferAvailability;
  ratingLabel?: string;
  description?: string;
  bookingUrl?: string;
  sourceId?: string;
  fetchedAt: string;
  structured: boolean;
  rawText?: string;
  rawJson?: unknown;
}

export type OfferProviderLevel = "REAL" | "UNAVAILABLE" | "UNKNOWN" | "UNSTRUCTURED";

export interface OfferProviderStatus {
  overall: OfferProviderLevel;
  fetchedAt?: string;
  warnings?: string[];
}
