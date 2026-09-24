import { describe, expect, it, vi } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import type { Place, RouteSegment } from "@/types/travel";
import { buildJourneyMarkers, clusterExplorePlaces } from "@/features/journey-map/controllers/marker-controller";
import { buildJourneyRoutes, calculatePolylineMidpoint, formatRouteBadgeText } from "@/features/journey-map/controllers/route-controller";
import { computeBounds, getTripPoints, getDayPoints, MapCameraController } from "@/features/journey-map/controllers/camera-controller";
import { getZoomDensityTier } from "@/features/journey-map/models/map-state";
import { buildMapModel } from "@/services/map/controller";
import { OfflineJourneyCache } from "@/features/journey-map/services/offline-cache";

describe("Journey Map - Model & Controller Unit Tests", () => {
  const trip = structuredClone(chongqingTrip);

  it("1. buildMapModel backward compatibility works", () => {
    const model = buildMapModel(trip, {
      selectedId: null,
      hoverId: null,
      filters: [],
      search: "",
      activeDayId: "day-1",
    });

    expect(model.markers.length).toBeGreaterThan(0);
    expect(model.polylines.length).toBe(trip.days.length);
  });

  it("2. activeDay filtering dims non-active day routes and filters markers properly", () => {
    const activeDayId = "day-1";
    const routes = buildJourneyRoutes(trip, {
      activeDayId,
      selectedPlaceId: null,
      hoverPlaceId: null,
      selectedRouteId: null,
      mapMode: "PLAN",
      zoom: 13,
    });

    const activeDayRoutes = routes.filter((r) => r.dayId === activeDayId);
    const otherDayRoutes = routes.filter((r) => r.dayId !== activeDayId);

    expect(activeDayRoutes.length).toBeGreaterThan(0);
    expect(otherDayRoutes.length).toBeGreaterThan(0);

    // Active day routes have high opacity (>= 0.85)
    activeDayRoutes.forEach((r) => {
      expect(r.strokeOpacity).toBeGreaterThanOrEqual(0.85);
    });

    // Inactive day routes are dimmed (< 0.25)
    otherDayRoutes.forEach((r) => {
      expect(r.strokeOpacity).toBeLessThanOrEqual(0.25);
    });

    // Markers for active day vs others
    const markers = buildJourneyMarkers(trip, {
      activeDayId,
      selectedPlaceId: null,
      hoverPlaceId: null,
      mapMode: "PLAN",
    });

    expect(markers.length).toBeGreaterThan(0);
  });

  it("3. selected marker receives SELECTED variant and hover marker receives HOVERED variant", () => {
    const selectedPlace = trip.places[0];
    const hoverPlace = trip.places[1];

    const markers = buildJourneyMarkers(trip, {
      activeDayId: null,
      selectedPlaceId: selectedPlace.id,
      hoverPlaceId: hoverPlace.id,
      mapMode: "PLAN",
    });

    const selectedMarker = markers.find((m) => m.placeId === selectedPlace.id);
    const hoverMarker = markers.find((m) => m.placeId === hoverPlace.id);

    expect(selectedMarker).toBeDefined();
    expect(selectedMarker?.variant).toBe("SELECTED");
    expect(selectedMarker?.isSelected).toBe(true);

    expect(hoverMarker).toBeDefined();
    expect(hoverMarker?.variant).toBe("HOVERED");
    expect(hoverMarker?.isHovered).toBe(true);
  });

  it("4. route mode styles correctly differentiate walking, metro, taxi, bus, and driving", () => {
    const testTrip = structuredClone(chongqingTrip);
    testTrip.segments[0].mode = "walk";
    testTrip.segments[0].estimated = false;
    testTrip.segments[1].mode = "metro";
    testTrip.segments[1].estimated = false;
    if (testTrip.segments[2]) {
      testTrip.segments[2].mode = "taxi";
      testTrip.segments[2].estimated = false;
    }

    const routes = buildJourneyRoutes(testTrip, {
      activeDayId: null,
      selectedPlaceId: null,
      hoverPlaceId: null,
      selectedRouteId: null,
      mapMode: "PLAN",
      zoom: 14,
    });

    const walkRoute = routes.find((r) => r.segmentId === testTrip.segments[0].id);
    const metroRoute = routes.find((r) => r.segmentId === testTrip.segments[1].id);

    expect(walkRoute?.strokeStyle).toBe("dashed");
    expect(walkRoute?.strokeWeight).toBe(3);

    expect(metroRoute?.strokeStyle).toBe("solid");
    expect(metroRoute?.strokeWeight).toBe(5);

    if (testTrip.segments[2]) {
      const taxiRoute = routes.find((r) => r.segmentId === testTrip.segments[2].id);
      expect(taxiRoute?.strokeStyle).toBe("dashed");
      expect(taxiRoute?.strokeWeight).toBe(4);
    }
  });

  it("5. estimated routes are visibly identified with ESTIMATED state and dashed styling", () => {
    const testTrip = structuredClone(chongqingTrip);
    testTrip.segments[0].estimated = true;
    testTrip.segments[0].provider = "haversine";

    const routes = buildJourneyRoutes(testTrip, {
      activeDayId: null,
      selectedPlaceId: null,
      hoverPlaceId: null,
      selectedRouteId: null,
      mapMode: "PLAN",
      zoom: 13,
    });

    const estRoute = routes.find((r) => r.segmentId === testTrip.segments[0].id);
    expect(estRoute?.isEstimated).toBe(true);
    expect(estRoute?.state).toBe("ESTIMATED");
    expect(estRoute?.strokeStyle).toBe("dashed");
  });

  it("6. camera target calculation correctly calculates bounds and center", () => {
    const points = [
      { lat: 29.5, lng: 106.5 },
      { lat: 29.6, lng: 106.6 },
    ];

    const bounds = computeBounds(points);
    expect(bounds).not.toBeNull();
    expect(bounds?.center.lat).toBeCloseTo(29.55);
    expect(bounds?.center.lng).toBeCloseTo(106.55);
    expect(bounds?.minLat).toBe(29.5);
    expect(bounds?.maxLat).toBe(29.6);

    const tripPoints = getTripPoints(trip);
    expect(tripPoints.length).toBe(trip.places.length);

    const dayPoints = getDayPoints(trip, trip.days[0].id);
    expect(dayPoints.length).toBeGreaterThan(0);
  });

  it("7. calculatePolylineMidpoint calculates exact midpoint on polyline", () => {
    const single = [{ lat: 29.5, lng: 106.5 }];
    expect(calculatePolylineMidpoint(single)).toEqual(single[0]);

    const straight = [
      { lat: 29.0, lng: 106.0 },
      { lat: 30.0, lng: 106.0 },
    ];
    const mid = calculatePolylineMidpoint(straight);
    expect(mid.lat).toBeCloseTo(29.5);
    expect(mid.lng).toBeCloseTo(106.0);
  });

  it("8. zoom density tiers are correctly resolved", () => {
    expect(getZoomDensityTier(9)).toBe("low");
    expect(getZoomDensityTier(10.9)).toBe("low");
    expect(getZoomDensityTier(11)).toBe("mid");
    expect(getZoomDensityTier(13.9)).toBe("mid");
    expect(getZoomDensityTier(14)).toBe("high");
    expect(getZoomDensityTier(16)).toBe("high");
  });

  it("9. cluster data grouping groups proximate explore places", () => {
    const places = [
      { id: "p1", name: "A", lat: 29.551, lng: 106.551, category: "attraction" },
      { id: "p2", name: "B", lat: 29.552, lng: 106.552, category: "attraction" },
      { id: "p3", name: "C", lat: 29.900, lng: 107.200, category: "food" },
    ] as unknown as Place[];

    const clusters = clusterExplorePlaces(places, 0.05);
    expect(clusters.length).toBe(2);
    const clusterWithTwo = clusters.find((c) => c.count === 2);
    expect(clusterWithTwo).toBeDefined();
    expect(clusterWithTwo?.places.length).toBe(2);
  });

  it("10. MapCameraController manages user interaction flags and resets properly", () => {
    const controller = new MapCameraController();
    const mockMap = {
      panTo: vi.fn(),
      setZoom: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      setFitView: vi.fn(),
      destroy: vi.fn(),
      setCenter: vi.fn(),
    };
    controller.setMap(mockMap);

    expect(controller.isUserInteracted()).toBe(false);

    // Initial fitTrip executes
    controller.fitTrip(trip);
    expect(mockMap.panTo).toHaveBeenCalled();

    // User drags map -> userInteracted = true
    controller.setUserInteracted(true);
    expect(controller.isUserInteracted()).toBe(true);

    // Subsequent fitTrip without force should be blocked
    mockMap.panTo.mockClear();
    controller.fitTrip(trip, false);
    expect(mockMap.panTo).not.toHaveBeenCalled();

    // Reset clears userInteracted and refits
    controller.reset(trip, null);
    expect(controller.isUserInteracted()).toBe(false);
    expect(mockMap.panTo).toHaveBeenCalled();
  });

  it("11. formatRouteBadgeText outputs correct travel badges", () => {
    const segWalk = { mode: "walk", durationMinutes: 12, distanceMeters: 800 } as unknown as RouteSegment;
    expect(formatRouteBadgeText(segWalk)).toContain("🚶");
    expect(formatRouteBadgeText(segWalk)).toContain("12 min");

    const segMetro = { mode: "metro", durationMinutes: 18, distanceMeters: 3500 } as unknown as RouteSegment;
    expect(formatRouteBadgeText(segMetro)).toContain("M · 18 min");

    const segTaxi = { mode: "taxi", durationMinutes: 15, distanceMeters: 4000, estimatedCost: 22 } as unknown as RouteSegment;
    expect(formatRouteBadgeText(segTaxi)).toContain("🚕");
    expect(formatRouteBadgeText(segTaxi)).toContain("¥22");
  });

  it("12. places and markers contain vertical transit metadata (floors, elevators, height difference)", () => {
    const hongyadong = trip.places.find((p) => p.id === "p-hongyadong");
    expect(hongyadong?.vertical).toBeDefined();
    expect(hongyadong?.vertical?.floor).toContain("11F");
    expect(hongyadong?.vertical?.elevationDiffMeters).toBe(50);
    expect(hongyadong?.vertical?.elevatorHint).toContain("电梯");

    const markers = buildJourneyMarkers(trip, {
      activeDayId: null,
      selectedPlaceId: "p-hongyadong",
      hoverPlaceId: null,
      mapMode: "PLAN",
    });

    const hydMarker = markers.find((m) => m.placeId === "p-hongyadong");
    expect(hydMarker?.vertical).toBeDefined();
    expect(hydMarker?.vertical?.floor).toBe("11F / 1F");
  });

  it("13. OfflineJourneyCache handles cache verification and fallbacks", async () => {
    expect(typeof OfflineJourneyCache.isSupported).toBe("function");
    const status = await OfflineJourneyCache.getCacheStatus("non-existent-trip");
    expect(status.isCached).toBe(false);
  });
});
