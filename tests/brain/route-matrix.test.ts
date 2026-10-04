// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ProviderRoute, TravelDataProvider } from "@/skill/providers";
import type { Place } from "@/types/travel";
import {
  buildRouteMatrix,
  clearRouteMatrixCache,
  findRealMatrixRoute,
  routeIntelByPlace,
  summarizeRouteMatrix,
} from "@/services/brain/route-matrix";

function place(id: string, name: string, lat: number, lng: number, overrides: Partial<Place> = {}): Place {
  return {
    id,
    name,
    category: "attraction",
    lat,
    lng,
    rating: 4,
    reviewCount: 10,
    image: "",
    priceLevel: 1,
    address: `${name}地址`,
    openingStatus: "unknown",
    stayMinutes: 90,
    description: name,
    tags: [],
    district: "测试区",
    source: "amap",
    sourceId: id,
    provenance: { source: "amap", estimated: false },
    ...overrides,
  };
}

const CQ = { lat: 29.56, lng: 106.55 };

function countingProvider(route?: Partial<ProviderRoute>) {
  const provider: TravelDataProvider & { calls: number } = {
    kind: "amap",
    calls: 0,
    async searchPlaces() {
      return [];
    },
    async getWeather() {
      return [];
    },
    async planRoute(input) {
      provider.calls += 1;
      return {
        source: "amap",
        mode: input.mode,
        distanceMeters: 850,
        durationMinutes: 13,
        polyline: [[CQ.lng, CQ.lat]],
        steps: [{ instruction: "沿道路步行", distanceMeters: 850, durationMinutes: 13 }],
        ...route,
      };
    },
  };
  return provider;
}

describe("route matrix builder", () => {
  it("queries at most maxRealEdges realtime routes and labels the rest as estimates", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    const places = Array.from({ length: 10 }, (_, i) =>
      place(`p-${i}`, `地点${i}`, CQ.lat + i * 0.01, CQ.lng),
    );
    const { matrix } = await buildRouteMatrix({
      city: "测试市",
      places,
      provider,
      maxRealEdges: 4,
      neighborsPerPlace: 2,
      travelers: 2,
    });
    expect(provider.calls).toBeLessThanOrEqual(4);
    const queried = matrix.edges.filter((edge) => edge.queried);
    expect(queried.length).toBe(provider.calls);
    expect(matrix.edges.every((edge) => (edge.queried ? edge.level === "REAL" : edge.level === "ESTIMATED"))).toBe(true);
    expect(matrix.mode).toBe("walk");
  });

  it("prefers edges incident to priority places when selecting real queries", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    const near = place("near-a", "近A", CQ.lat, CQ.lng);
    const nearB = place("near-b", "近B", CQ.lat + 0.001, CQ.lng);
    const farPriority = place("far-must", "远必去", CQ.lat + 0.3, CQ.lng + 0.3);
    const farOther = place("far-other", "远其他", CQ.lat + 0.301, CQ.lng + 0.301);
    const { matrix } = await buildRouteMatrix({
      city: "测试市",
      places: [near, nearB, farPriority, farOther],
      provider,
      priorityPlaceIds: ["far-must"],
      maxRealEdges: 1,
      neighborsPerPlace: 1,
    });
    expect(matrix.edges.filter((edge) => edge.queried)).toHaveLength(1);
    const queriedEdge = matrix.edges.find((edge) => edge.queried)!;
    expect([queriedEdge.fromPlaceId, queriedEdge.toPlaceId].sort()).toEqual(["far-must", "far-other"].sort());
  });

  it("reuses cached real routes for the same city/pair/mode without new provider calls", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    const places = [place("c-1", "甲", CQ.lat, CQ.lng), place("c-2", "乙", CQ.lat + 0.004, CQ.lng)];
    const first = await buildRouteMatrix({ city: "缓存市", places, provider, maxRealEdges: 1, neighborsPerPlace: 1 });
    const callsAfterFirst = provider.calls;
    expect(callsAfterFirst).toBe(1);
    const second = await buildRouteMatrix({ city: "缓存市", places, provider, maxRealEdges: 1, neighborsPerPlace: 1 });
    expect(provider.calls).toBe(1);
    expect(second.matrix.edges.find((edge) => edge.queried)?.level).toBe("REAL");
    expect(first.matrix.edges.find((edge) => edge.queried)?.durationMinutes).toBe(
      second.matrix.edges.find((edge) => edge.queried)?.durationMinutes,
    );
  });

  it("keeps estimated edges when no provider is available", async () => {
    clearRouteMatrixCache();
    const { matrix, realRoutes } = await buildRouteMatrix({
      city: "无供应商市",
      places: [place("n-1", "一", CQ.lat, CQ.lng), place("n-2", "二", CQ.lat + 0.01, CQ.lng)],
      maxRealEdges: 2,
      neighborsPerPlace: 1,
    });
    expect(realRoutes.size).toBe(0);
    expect(matrix.edges.every((edge) => !edge.queried && edge.level === "ESTIMATED")).toBe(true);
    // Nothing could be measured without a provider — coverage says so honestly.
    expect(matrix.coverage).toBe(0);
  });

  it("falls back to estimates per-edge when the provider route fails", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    provider.planRoute = async () => {
      provider.calls += 1;
      throw new Error("amap down");
    };
    const { matrix, realRoutes } = await buildRouteMatrix({
      city: "故障市",
      places: [place("f-1", "甲", CQ.lat, CQ.lng), place("f-2", "乙", CQ.lat + 0.008, CQ.lng)],
      provider,
      maxRealEdges: 1,
      neighborsPerPlace: 1,
    });
    expect(provider.calls).toBe(1);
    expect(realRoutes.size).toBe(0);
    expect(matrix.edges.every((edge) => edge.level === "ESTIMATED")).toBe(true);
  });

  it("findRealMatrixRoute resolves both directions and only for queried edges", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    const a = place("r-1", "甲", CQ.lat, CQ.lng);
    const b = place("r-2", "乙", CQ.lat + 0.002, CQ.lng);
    const c = place("r-3", "丙", CQ.lat + 0.2, CQ.lng + 0.2);
    const { realRoutes } = await buildRouteMatrix({
      city: "查询市",
      places: [a, b, c],
      provider,
      maxRealEdges: 1,
      neighborsPerPlace: 1,
    });
    expect(findRealMatrixRoute(realRoutes, "r-1", "r-2")).toBeTruthy();
    expect(findRealMatrixRoute(realRoutes, "r-2", "r-1")).toBeTruthy();
    expect(findRealMatrixRoute(realRoutes, "r-1", "r-3")).toBeUndefined();
  });

  it("route intel and summary expose nearest neighbours with provenance labels", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    const a = place("s-1", "洪崖洞", CQ.lat, CQ.lng);
    const b = place("s-2", "长江索道", CQ.lat + 0.003, CQ.lng);
    const far = place("s-3", "远郊古镇", CQ.lat + 0.35, CQ.lng + 0.35);
    const { matrix } = await buildRouteMatrix({
      city: "摘要市",
      places: [a, b, far],
      provider,
      maxRealEdges: 2,
      neighborsPerPlace: 2,
    });
    const intel = routeIntelByPlace([a, b, far], matrix);
    expect(intel["s-1"]).toContain("长江索道");
    expect(intel["s-1"]).toMatch(/\[实测\]|\[估算\]/);
    const summary = summarizeRouteMatrix([a, b, far], matrix);
    expect(summary).toContain("路线情报");
    expect(summary).toContain("洪崖洞");
  });

  it("drops places with non-finite coordinates instead of throwing", async () => {
    clearRouteMatrixCache();
    const provider = countingProvider();
    const broken = place("x-1", "坏坐标", Number.NaN, CQ.lng);
    const good = place("x-2", "好坐标", CQ.lat, CQ.lng);
    const { matrix } = await buildRouteMatrix({
      city: "清洗市",
      places: [broken, good],
      provider,
      maxRealEdges: 1,
      neighborsPerPlace: 1,
    });
    expect(matrix.edges).toHaveLength(0);
    expect(provider.calls).toBe(0);
  });
});
