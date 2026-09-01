import type { BookingOffer, BookingProvider } from "./types";

export class MockBookingProvider implements BookingProvider {
  readonly id = "mock" as const;

  hotelLink(params: { name: string; city: string; checkIn: string; checkOut: string }): BookingOffer {
    const q = encodeURIComponent(`${params.city} ${params.name}`);
    return {
      provider: "MockStay",
      label: "去预订",
      url: `https://example.com/hotels?q=${q}&checkIn=${params.checkIn}&checkOut=${params.checkOut}`,
    };
  }

  activityLink(params: { name: string; city: string }): BookingOffer {
    const q = encodeURIComponent(`${params.city} ${params.name}`);
    return {
      provider: "MockTicket",
      label: "查看活动",
      url: `https://example.com/events?q=${q}`,
    };
  }
}

export const bookingProvider: BookingProvider = new MockBookingProvider();
