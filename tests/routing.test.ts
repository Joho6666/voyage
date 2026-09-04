import { describe, expect, it } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import { dayStats, recomputeDay, fetchRealRoute } from "@/services/routing";

describe("routing", () => {
  it("assigns endTime after each stop", () => {
    const next = recomputeDay(chongqingTrip, "day-1");
    const items = next.items.filter((i) => i.dayId === "day-1").sort((a, b) => a.order - b.order);
    expect(items[0]?.endTime).toMatch(/^\d{2}:\d{2}$/);
    expect(items.length).toBeGreaterThan(2);
  });

  it("computes place count, realCount, and distance for a day", () => {
    const stats = dayStats(chongqingTrip, "day-1");
    expect(stats.places).toBeGreaterThan(0);
    expect(stats.meters).toBeGreaterThan(0);
    expect(stats.estimatedCount).toBeGreaterThanOrEqual(0);
  });

  it("produces RouteSegments with full provenance and estimated flags", () => {
    const next = recomputeDay(chongqingTrip, "day-1");
    const segments = next.segments.filter((s) => s.dayId === "day-1");
    expect(segments.length).toBeGreaterThan(0);

    const firstSeg = segments[0]!;
    expect(firstSeg.fromPlaceId).toBeDefined();
    expect(firstSeg.toPlaceId).toBeDefined();
    expect(firstSeg.distanceMeters).toBeGreaterThan(0);
    expect(firstSeg.durationMinutes).toBeGreaterThan(0);
    expect(firstSeg.polyline).toBeDefined();
    expect(firstSeg.provider).toBe("haversine");
    expect(firstSeg.estimated).toBe(true);
    expect(firstSeg.updatedAt).toBeDefined();
  });

  it("fetchRealRoute falls back safely without error", async () => {
    const origin = { lng: 106.577, lat: 29.557 };
    const destination = { lng: 106.583, lat: 29.563 };
    const route = await fetchRealRoute(origin, destination, "walk");
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(route.durationMinutes).toBeGreaterThan(0);
    expect(route.polyline.length).toBeGreaterThanOrEqual(2);
  });
});
