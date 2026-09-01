"use client";

import { TravelImage } from "@/components/travel/TravelImage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { bookingProvider } from "@/services/booking/mock";
import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";

export default function HotelsPage() {
  const trip = useTripStore((s) => s.trip);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">住宿</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">MVP 不支付。预订走 Mock Booking Link。</p>
      <div className="mt-4 space-y-4">
        {trip.hotels.map((hotel) => {
          const offer = bookingProvider.hotelLink({
            name: hotel.name,
            city: trip.destination,
            checkIn: trip.startDate,
            checkOut: trip.endDate,
          });
          return (
            <article key={hotel.id} className="overflow-hidden rounded-[14px] border border-border">
              <TravelImage src={hotel.image} alt={hotel.name} />
              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-medium">{hotel.name}</h2>
                    <p className="text-[12px] text-muted-foreground">
                      {hotel.rating.toFixed(1)} · {hotel.district} · 距路线中心 {hotel.distanceToCenterKm} km
                    </p>
                  </div>
                  <p className="text-sm font-medium">{formatCny(hotel.pricePerNight)} / 晚</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {hotel.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
                <p className="text-[13px] leading-5 text-muted-foreground">{hotel.insight}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={offer.url} target="_blank" rel="noreferrer">
                      查看
                    </a>
                  </Button>
                  <Button size="sm" asChild>
                    <a href={offer.url} target="_blank" rel="noreferrer">
                      {offer.label}
                    </a>
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
