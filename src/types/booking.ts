export type BookingProviderKind = "trip" | "booking" | "agoda" | "amap" | "fliggy" | "rail";

export interface BookingOption {
  id: string;
  provider: BookingProviderKind;
  providerName: string;
  title: string;
  category: "hotel" | "transport" | "ticket" | "restaurant";
  priceEstimate?: number;
  currency: string;
  deepLink: string;
  badge?: string;
  recommendedReason?: string;
}

export interface BookingIntent {
  id: string;
  tripId: string;
  type: "hotel" | "transport" | "activity";
  targetName: string;
  targetDate?: string;
  travelers: number;
  selectedOption?: BookingOption;
  options: BookingOption[];
  status: "browsing" | "redirected" | "confirmed";
  createdAt: string;
}
