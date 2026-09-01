"use client";

import Link from "next/link";
import { AppFrame } from "@/components/layout/AppFrame";
import { TravelImage } from "@/components/travel/TravelImage";
import { Button } from "@/components/ui/button";
import { chongqingTrip } from "@/data/demo/chongqing";
import { formatMonthDay, tripDurationLabel } from "@/lib/utils";

export default function TripsPage() {
  const trip = chongqingTrip;
  return (
    <AppFrame>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-medium">我的旅行</h1>
          <Button asChild>
            <Link href="/new-trip">新旅行</Link>
          </Button>
        </div>
        <Link href={`/trip/${trip.id}`} className="mt-6 block overflow-hidden rounded-[14px] border border-border">
          <TravelImage src={trip.coverImage} alt={trip.title} ratio="16/9" />
          <div className="p-4">
            <h2 className="text-base font-medium">{trip.title}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {trip.destination} · {tripDurationLabel(trip.startDate, trip.endDate)} · {formatMonthDay(trip.startDate)} – {formatMonthDay(trip.endDate)}
            </p>
          </div>
        </Link>
      </div>
    </AppFrame>
  );
}
