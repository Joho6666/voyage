export interface BookingOffer {
  provider: string;
  label: string;
  url: string;
}

export interface BookingProvider {
  readonly id: "mock" | "trip" | "booking" | "agoda";
  hotelLink(params: { name: string; city: string; checkIn: string; checkOut: string }): BookingOffer;
  activityLink(params: { name: string; city: string }): BookingOffer;
}
