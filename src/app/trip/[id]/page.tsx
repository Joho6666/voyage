"use client";

import { ItineraryPanel } from "@/components/itinerary/ItineraryPanel";
import { MobileTripSheet } from "@/components/itinerary/MobileTripSheet";

export default function TripPage() {
  return (
    <div className="flex h-full flex-col pb-14 md:pb-0">
      <div className="hidden h-full md:block">
        <ItineraryPanel />
      </div>
      <div className="relative h-full md:hidden">
        <MobileTripSheet />
      </div>
    </div>
  );
}
