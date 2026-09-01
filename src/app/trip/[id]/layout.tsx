"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { TripShell } from "@/components/layout/TripShell";
import { MockMap } from "@/components/map/MockMap";
import { tripRepository } from "@/services/trips/repository";
import { hydrateTrip } from "@/store/trip-store";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();

  useEffect(() => {
    void tripRepository.get(params.id).then((trip) => {
      if (trip) hydrateTrip(trip);
    });
  }, [params.id]);

  return (
    <TripShell tripId={params.id} map={<MockMap />}>
      {children}
    </TripShell>
  );
}
