import type { Trip } from "@/types/travel";

export interface OfflineCacheStatus {
  isCached: boolean;
  cachedAt: number | null;
  placeCount: number;
  segmentCount: number;
  sizeBytes?: number;
}

const CACHE_NAME = "voyage-journey-offline-v1";

export class OfflineJourneyCache {
  static isSupported(): boolean {
    return typeof window !== "undefined" && "caches" in window;
  }

  static async registerServiceWorker(): Promise<void> {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch {
      // Graceful fallback if ServiceWorker cannot be registered
    }
  }

  static async cacheTrip(trip: Trip): Promise<OfflineCacheStatus> {
    if (!this.isSupported()) {
      return {
        isCached: false,
        cachedAt: null,
        placeCount: trip.places.length,
        segmentCount: trip.segments.length,
      };
    }

    try {
      const cache = await caches.open(CACHE_NAME);
      const payload = {
        trip,
        cachedAt: Date.now(),
        version: "1.0",
      };

      const response = new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "X-Voyage-Offline": "true",
        },
      });

      await cache.put(`/offline-trip-${trip.id}`, response);

      // Pre-cache place images if valid http/https URLs
      const imageUrls = trip.places
        .map((p) => p.image)
        .filter((url): url is string => Boolean(url && url.startsWith("http")));

      await Promise.allSettled(
        imageUrls.slice(0, 10).map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            // Ignore individual image cache misses
          }
        }),
      );

      return {
        isCached: true,
        cachedAt: payload.cachedAt,
        placeCount: trip.places.length,
        segmentCount: trip.segments.length,
      };
    } catch {
      return {
        isCached: false,
        cachedAt: null,
        placeCount: trip.places.length,
        segmentCount: trip.segments.length,
      };
    }
  }

  static async getCachedTrip(tripId: string): Promise<Trip | null> {
    if (!this.isSupported()) return null;

    try {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(`/offline-trip-${tripId}`);
      if (!res) return null;
      const data = (await res.json()) as { trip: Trip };
      return data.trip || null;
    } catch {
      return null;
    }
  }

  static async getCacheStatus(tripId: string): Promise<OfflineCacheStatus> {
    if (!this.isSupported()) {
      return { isCached: false, cachedAt: null, placeCount: 0, segmentCount: 0 };
    }

    try {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(`/offline-trip-${tripId}`);
      if (!res) {
        return { isCached: false, cachedAt: null, placeCount: 0, segmentCount: 0 };
      }
      const data = (await res.json()) as { trip: Trip; cachedAt: number };
      return {
        isCached: true,
        cachedAt: data.cachedAt,
        placeCount: data.trip?.places?.length || 0,
        segmentCount: data.trip?.segments?.length || 0,
      };
    } catch {
      return { isCached: false, cachedAt: null, placeCount: 0, segmentCount: 0 };
    }
  }

  static async clearTripCache(tripId: string): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const cache = await caches.open(CACHE_NAME);
      return await cache.delete(`/offline-trip-${tripId}`);
    } catch {
      return false;
    }
  }
}
