"use client";

import { useEffect, useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { TripShell } from "@/components/layout/TripShell";
import { MapCanvas } from "@/components/map/MapCanvas";
import { toast } from "sonner";
import { hydrateTrip } from "@/store/trip-store";
import { useTripStore } from "@/store/trip-store";
import type { MapMode } from "@/features/journey-map/models/map-state";
import type { Trip } from "@/types/travel";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const loadedTripId = useTripStore((state) => state.trip.id);

  useEffect(() => {
    void fetch(`/api/voyage/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "get-trip", input: { tripId: params.id } }) })
      .then(async (response) => {
        const payload = await response.json() as { data?: { trip?: Trip; revision?: number } };
        if (payload.data?.trip) { hydrateTrip(payload.data.trip, payload.data.revision); return; }
        const fallback = await fetch(`/api/voyage/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tripId: params.id }) });
        if (!fallback.ok) { toast.error("行程不存在，返回列表页"); router.replace("/trips"); return; }
        const legacy = await fallback.json() as { trip?: Trip; revision?: number };
        if (legacy.trip) hydrateTrip(legacy.trip, legacy.revision);
        else { toast.error("行程不存在，返回列表页"); router.replace("/trips"); }
      }).catch(() => { toast.error("网络异常，返回列表页"); router.replace("/trips"); });
  }, [params.id, router]);

  const mapMode: MapMode = useMemo(() => {
    if (pathname.includes("/today")) return "TODAY";
    if (
      pathname.includes("/explore") ||
      pathname.includes("/food") ||
      pathname.includes("/hotels") ||
      pathname.includes("/activities")
    ) {
      return "EXPLORE";
    }
    return "PLAN";
  }, [pathname]);

  if (loadedTripId !== params.id) {
    return <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground" role="status">正在加载行程…</div>;
  }

  return (
    <TripShell tripId={params.id} map={<MapCanvas mode={mapMode} />}>
      {children}
    </TripShell>
  );
}
