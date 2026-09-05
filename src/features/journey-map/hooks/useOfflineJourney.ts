"use client";

import { useCallback, useEffect, useState } from "react";
import type { Trip } from "@/types/travel";
import { OfflineJourneyCache, type OfflineCacheStatus } from "../services/offline-cache";
import { toast } from "sonner";

export function useOfflineJourney(trip: Trip) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [status, setStatus] = useState<OfflineCacheStatus>({
    isCached: false,
    cachedAt: null,
    placeCount: trip.places.length,
    segmentCount: trip.segments.length,
  });
  const [isCaching, setIsCaching] = useState<boolean>(false);

  // Check online/offline network events
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      toast.success("已恢复网络连接");
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.info("已切换至离线模式，正在使用本地离线轨迹包");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Register SW
    void OfflineJourneyCache.registerServiceWorker();

    // Check existing cache status
    void OfflineJourneyCache.getCacheStatus(trip.id).then(setStatus);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [trip.id]);

  const cacheTrip = useCallback(async () => {
    if (!OfflineJourneyCache.isSupported()) {
      toast.error("当前浏览器环境不支持离线缓存");
      return;
    }

    setIsCaching(true);
    try {
      const res = await OfflineJourneyCache.cacheTrip(trip);
      setStatus(res);
      if (res.isCached) {
        toast.success(`离线包就绪：${res.placeCount} 个地点与 ${res.segmentCount} 条路线已缓存`);
      } else {
        toast.error("离线包生成失败，请重试");
      }
    } catch {
      toast.error("离线包生成失败");
    } finally {
      setIsCaching(false);
    }
  }, [trip]);

  const clearCache = useCallback(async () => {
    await OfflineJourneyCache.clearTripCache(trip.id);
    setStatus({
      isCached: false,
      cachedAt: null,
      placeCount: trip.places.length,
      segmentCount: trip.segments.length,
    });
    toast.message("已清除离线轨迹缓存");
  }, [trip.id, trip.places.length, trip.segments.length]);

  return {
    isOnline,
    isCached: status.isCached,
    isCaching,
    cachedAt: status.cachedAt,
    cacheTrip,
    clearCache,
  };
}
