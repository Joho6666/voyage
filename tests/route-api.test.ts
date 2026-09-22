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
});
