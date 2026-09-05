"use client";

import { useEffect, useMemo } from "react";
import { useParams, usePathname } from "next/navigation";
import { TripShell } from "@/components/layout/TripShell";
import { MapCanvas } from "@/components/map/MapCanvas";
import { tripRepository } from "@/services/trips/repository";
import { hydrateTrip } from "@/store/trip-store";
import type { MapMode } from "@/features/journey-map/models/map-state";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();

  useEffect(() => {
    void tripRepository.get(params.id).then((trip) => {
      if (trip) hydrateTrip(trip);
    });
  }, [params.id]);

  const mapMode: MapMode = useMemo(() => {
    if (pathname.includes("/today")) return "TODAY";
    if (pathname.includes("/explore")) return "EXPLORE";
    return "PLAN";
  }, [pathname]);

  return (
    <TripShell tripId={params.id} map={<MapCanvas mode={mapMode} />}>
      {children}
    </TripShell>
  );
}
