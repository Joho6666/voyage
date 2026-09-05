import type { AMapInstance, AMapOverlay } from "@/services/map/amap-js";
import type { JourneyMarker } from "../models/marker-model";
import type { JourneyRoute } from "../models/route-model";

interface RegistryItem {
  overlay: AMapOverlay;
  type: "marker" | "polyline" | "badge";
  key: string;
  fingerprint: string;
}

export class MapOverlayRegistry {
  private map: AMapInstance | null = null;
  private items: Map<string, RegistryItem> = new Map();

  setMap(map: AMapInstance | null) {
    if (this.map && this.map !== map) {
      this.clear();
    }
    this.map = map;
  }

  clear() {
    this.items.forEach(({ overlay }) => {
      overlay.setMap(null);
    });
    this.items.clear();
  }

  syncMarkers(
    markers: JourneyMarker[],
    handlers: {
      onSelectPlace: (placeId: string) => void;
      onHoverPlace: (placeId: string | null) => void;
    },
    renderMarkerHtml: (marker: JourneyMarker) => string,
  ) {
    const map = this.map;
    if (!map || !window.AMap) return;
    const AMap = window.AMap;
    const nextKeys = new Set(markers.map((m) => m.id));

    // 1. Remove markers no longer present
    this.items.forEach((item, key) => {
      if (item.type === "marker" && !nextKeys.has(key)) {
        item.overlay.setMap(null);
        this.items.delete(key);
      }
    });

    // 2. Add or update markers
    markers.forEach((marker) => {
      const fingerprint = `${marker.lat},${marker.lng}_${marker.variant}_${marker.isSelected}_${marker.isHovered}_${marker.color}_${marker.number}_${marker.title}`;
      const existing = this.items.get(marker.id);

      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          // Update existing marker DOM content and zIndex
          const content = renderMarkerHtml(marker);
          if (typeof existing.overlay.setContent === "function") {
            existing.overlay.setContent(content);
          }
          if (typeof existing.overlay.setzIndex === "function") {
            existing.overlay.setzIndex(
              marker.isSelected ? 200 : marker.isHovered ? 150 : marker.isNext ? 120 : 20,
            );
          }
          if (typeof existing.overlay.setPosition === "function") {
            existing.overlay.setPosition([marker.lng, marker.lat]);
          }
          existing.fingerprint = fingerprint;
        }
      } else {
        // Create new Marker
        const content = renderMarkerHtml(marker);
        const pin = new AMap.Marker({
          position: [marker.lng, marker.lat],
          content,
          offset: new AMap.Pixel(-14, -14),
          zIndex: marker.isSelected ? 200 : marker.isHovered ? 150 : marker.isNext ? 120 : 20,
        });

        pin.on("click", () => handlers.onSelectPlace(marker.placeId));
        pin.on("mouseover", () => handlers.onHoverPlace(marker.placeId));
        pin.on("mouseout", () => handlers.onHoverPlace(null));

        map.add(pin);
        this.items.set(marker.id, {
          overlay: pin,
          type: "marker",
          key: marker.id,
          fingerprint,
        });
      }
    });
  }

  syncRoutes(
    routes: JourneyRoute[],
    handlers: {
      onSelectRoute: (segmentId: string) => void;
      onHoverRoute?: (segmentId: string | null) => void;
    },
    renderBadgeHtml: (route: JourneyRoute) => string,
  ) {
    const map = this.map;
    if (!map || !window.AMap) return;
    const AMap = window.AMap;

    const nextRouteKeys = new Set(routes.map((r) => r.id));
    const nextBadgeKeys = new Set(
      routes.filter((r) => r.badge).map((r) => `badge-${r.id}`),
    );

    // 1. Remove obsolete polylines & badges
    this.items.forEach((item, key) => {
      if (item.type === "polyline" && !nextRouteKeys.has(key)) {
        item.overlay.setMap(null);
        this.items.delete(key);
      }
      if (item.type === "badge" && !nextBadgeKeys.has(key)) {
        item.overlay.setMap(null);
        this.items.delete(key);
      }
    });

    // 2. Add or update polylines
    routes.forEach((route) => {
      const fingerprint = `${route.color}_${route.strokeWeight}_${route.strokeOpacity}_${route.strokeStyle}_${route.state}_${route.path.length}`;
      const existing = this.items.get(route.id);

      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          if (typeof existing.overlay.setOptions === "function") {
            existing.overlay.setOptions({
              path: route.path.map((p) => [p.lng, p.lat]),
              strokeColor: route.color,
              strokeWeight: route.strokeWeight,
              strokeOpacity: route.strokeOpacity,
              strokeStyle: route.strokeStyle,
              strokeDasharray: route.strokeDasharray,
            });
          }
          existing.fingerprint = fingerprint;
        }
      } else {
        const polyline = new AMap.Polyline({
          path: route.path.map((p) => [p.lng, p.lat]),
          strokeColor: route.color,
          strokeWeight: route.strokeWeight,
          strokeOpacity: route.strokeOpacity,
          strokeStyle: route.strokeStyle,
          strokeDasharray: route.strokeDasharray,
          lineJoin: "round",
          lineCap: "round",
          zIndex: route.state === "ACTIVE" ? 40 : 10,
        });

        polyline.on("click", () => handlers.onSelectRoute(route.segmentId));
        map.add(polyline);
        this.items.set(route.id, {
          overlay: polyline,
          type: "polyline",
          key: route.id,
          fingerprint,
        });
      }

      // 3. Route Badges
      const badgeKey = `badge-${route.id}`;
      if (route.badge) {
        const badgeFingerprint = `${route.badge.label}_${route.badge.state}_${route.badge.position.lat},${route.badge.position.lng}`;
        const existingBadge = this.items.get(badgeKey);

        if (existingBadge) {
          if (existingBadge.fingerprint !== badgeFingerprint) {
            const content = renderBadgeHtml(route);
            if (typeof existingBadge.overlay.setContent === "function") {
              existingBadge.overlay.setContent(content);
            }
            if (typeof existingBadge.overlay.setPosition === "function") {
              existingBadge.overlay.setPosition([
                route.badge.position.lng,
                route.badge.position.lat,
              ]);
            }
            existingBadge.fingerprint = badgeFingerprint;
          }
        } else {
          const content = renderBadgeHtml(route);
          const badgeOverlay = new AMap.Marker({
            position: [route.badge.position.lng, route.badge.position.lat],
            content,
            offset: new AMap.Pixel(-36, -14),
            zIndex: route.badge.state === "ACTIVE" ? 90 : 30,
          });
          badgeOverlay.on("click", () => handlers.onSelectRoute(route.segmentId));
          map.add(badgeOverlay);
          this.items.set(badgeKey, {
            overlay: badgeOverlay,
            type: "badge",
            key: badgeKey,
            fingerprint: badgeFingerprint,
          });
        }
      }
    });
  }
}
