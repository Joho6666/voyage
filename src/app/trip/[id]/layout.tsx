"use client";

import { useEffect, useMemo } from "react";
import { useParams, usePathname } from "next/navigation";
import { TripShell } from "@/components/layout/TripShell";
import { MapCanvas } from "@/components/map/MapCanvas";
import { hydrateTrip } from "@/store/trip-store";
import type { MapMode } from "@/features/journey-map/models/map-state";
import type { Trip } from "@/types/travel";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();

  useEffect(() => {
    void fetch(`/api/voyage/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "get-trip", input: { tripId: params.id } }) })
      .then(async (response) => {
        const payload = await response.json() as { data?: { trip?: Trip; revision?: number } };
        if (payload.data?.trip) { hydrateTrip(payload.data.trip, payload.data.revision); return; }
        const fallback = await fetch(`/api/voyage/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tripId: params.id }) });
        if (!fallback.ok) return;
        const legacy = await fallback.json() as { trip?: Trip; revision?: number };
        if (legacy.trip) hydrateTrip(legacy.trip, legacy.revision);
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
