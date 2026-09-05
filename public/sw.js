const CACHE_NAME = "voyage-journey-offline-v1";
const TILE_CACHE_NAME = "voyage-map-tiles-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cache AMap tiles / static map assets
  if (
    url.hostname.includes("amap.com") ||
    url.hostname.includes("autonavi.com") ||
    url.pathname.includes("/v3/")
  ) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) => {
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            return cache.match(event.request);
          });
      }),
    );
    return;
  }

  // Handle offline-trip requests
  if (url.pathname.startsWith("/offline-trip-")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          return cached || fetch(event.request);
        });
      }),
    );
    return;
  }
});
