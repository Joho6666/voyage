"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { TripShell } from "@/components/layout/TripShell";
import { MapCanvas } from "@/components/map/MapCanvas";
import { toast } from "sonner";
import { hydrateTrip } from "@/store/trip-store";
import { useTripStore } from "@/store/trip-store";
import { OfflineJourneyCache } from "@/features/journey-map/services/offline-cache";
import type { MapMode } from "@/features/journey-map/models/map-state";
import type { Trip } from "@/types/travel";

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const loadedTripId = useTripStore((state) => state.trip.id);

  useEffect(() => {
    void fetch(`/api/voyage/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "get-trip", input: { tripId: params.id } }),
    })
      .then(async (response) => {
        // 4xx/5xx means the server answered: "no such trip", not "offline".
        // Only a thrown/network error is an offline candidate.
        if (response.ok) {
          const payload = (await response.json()) as { data?: { trip?: Trip; revision?: number } };
          if (payload.data?.trip) {
            hydrateTrip(payload.data.trip, payload.data.revision);
            return;
          }
        }
        const fallback = await fetch(`/api/voyage/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tripId: params.id }),
        });
        if (!fallback.ok) {
          toast.error("行程不存在，返回列表页");
          router.replace("/trips");
          return;
        }
        const legacy = (await fallback.json()) as { trip?: Trip; revision?: number };
        if (legacy.trip) {
          hydrateTrip(legacy.trip, legacy.revision);
          OfflineJourneyCache.cacheTrip(legacy.trip).catch(() => {});
        } else {
          toast.error("行程不存在，返回列表页");
          router.replace("/trips");
        }
      })
      .catch(() => {
        // network failure: try offline as last resort
        OfflineJourneyCache.getCachedTrip(params.id).then((offlineTrip) => {
          if (offlineTrip) {
            hydrateTrip(offlineTrip, undefined);
            setOffline(true);
            toast("无网络，已加载离线行程包");
          } else {
            toast.error("无网络且无离线行程包，无法查看");
            router.replace("/trips");
          }
        });
      });
  }, [params.id, router]);

  const mapMode: MapMode = useMemo(() => {
    if (pathname.includes("/today")) return "TODAY";
    if (pathname.includes("/explore")) return "EXPLORE";
    return "PLAN";
  }, [pathname]);

  if (loadedTripId !== params.id) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground" role="status">
        正在加载行程…
      </div>
    );
  }

  return (
    <TripShell tripId={params.id} map={<MapCanvas mode={mapMode} />}>
      {offline ? (
        <p className="border-b border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-center text-[11px] text-amber-800 dark:text-amber-200">
          离线模式：正在显示已下载的离线包内容，写入操作暂不可用。
        </p>
      ) : null}
      {children}
    </TripShell>
  );
}