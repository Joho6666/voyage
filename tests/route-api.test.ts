import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/services/map/amap-rest", () => ({
  isAmapConfigured: vi.fn(() => true),
  amapWalkingRoute: vi.fn(),
  amapDrivingRoute: vi.fn(),
  amapTransitRoute: vi.fn(),
}));

import { amapWalkingRoute } from "@/services/map/amap-rest";
import { POST } from "@/app/api/amap/route/route";

describe("AMap route boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks successful AMap geometry authoritative", async () => {
    vi.mocked(amapWalkingRoute).mockResolvedValueOnce({ distanceMeters: 900, durationMinutes: 12, polyline: [[113, 23], [113.01, 23.01]], steps: [] });
    const response = await POST(new Request("http://local/api/amap/route", { method: "POST", body: JSON.stringify({ origin: { lng: 113, lat: 23 }, destination: { lng: 113.01, lat: 23.01 }, mode: "walk", provider: "forged" }) }));
    const result = await response.json();
    expect(result).toMatchObject({ source: "amap", estimated: false, distanceMeters: 900 });
  });

  it("marks provider failure as estimated Haversine", async () => {
    vi.mocked(amapWalkingRoute).mockRejectedValueOnce(new Error("offline"));
    const response = await POST(new Request("http://local/api/amap/route", { method: "POST", body: JSON.stringify({ origin: { lng: 114, lat: 24 }, destination: { lng: 114.01, lat: 24.01 }, mode: "walk" }) }));
    const result = await response.json();
    expect(result.source).toBe("haversine");
    expect(result.estimated).toBe(true);
  });

  it("does not cache the estimated Haversine fallback", async () => {
    const coords = { origin: { lng: 115, lat: 25 }, destination: { lng: 115.01, lat: 25.01 }, mode: "walk" };
    vi.mocked(amapWalkingRoute).mockRejectedValueOnce(new Error("offline"));
    const failed = await POST(new Request("http://local/api/amap/route", { method: "POST", body: JSON.stringify(coords) }));
    expect((await failed.json()).estimated).toBe(true);
    vi.mocked(amapWalkingRoute).mockResolvedValueOnce({ distanceMeters: 700, durationMinutes: 9, polyline: [[115, 25], [115.01, 25.01]], steps: [] });
    const recovered = await POST(new Request("http://local/api/amap/route", { method: "POST", body: JSON.stringify(coords) }));
    expect(await recovered.json()).toMatchObject({ source: "amap", estimated: false, distanceMeters: 700 });
  });

  it("caches real AMap responses to protect provider quota", async () => {
    const coords = { origin: { lng: 116, lat: 26 }, destination: { lng: 116.01, lat: 26.01 }, mode: "walk" };
    vi.mocked(amapWalkingRoute).mockResolvedValueOnce({ distanceMeters: 500, durationMinutes: 7, polyline: [[116, 26], [116.01, 26.01]], steps: [] });
    const first = await POST(new Request("http://local/api/amap/route", { method: "POST", body: JSON.stringify(coords) }));
    expect((await first.json()).source).toBe("amap");
    const second = await POST(new Request("http://local/api/amap/route", { method: "POST", body: JSON.stringify(coords) }));
    expect((await second.json()).source).toBe("amap");
    expect(amapWalkingRoute).toHaveBeenCalledTimes(1);
  });
});
