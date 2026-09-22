import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/services/map/amap-rest", () => ({
  isAmapConfigured: vi.fn(() => false),
  amapSearchPois: vi.fn(),
  amapGeocode: vi.fn(),
  amapWeather: vi.fn(),
}));

import { POST } from "@/app/api/agent/create/route";

describe("trip creation provider boundary", () => {
  afterEach(() => delete process.env.VOYAGE_DEMO_MODE);

  it("returns a structured error instead of a Chongqing trip for arbitrary cities", async () => {
    process.env.VOYAGE_DEMO_MODE = "false";
    const response = await POST(new Request("http://local/api/agent/create", { method: "POST", body: JSON.stringify({ destination: "广州", startDate: "2026-10-01", endDate: "2026-10-03" }) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "NO_PROVIDER_CONFIGURED" });
  });

  it("allows the fixture only in explicit demo mode and uses a UUID", async () => {
    process.env.VOYAGE_DEMO_MODE = "true";
    const response = await POST(new Request("http://local/api/agent/create", { method: "POST", body: JSON.stringify({ destination: "重庆", startDate: "2026-10-01", endDate: "2026-10-03" }) }));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.source).toBe("rules");
    expect(result.mapProvider).toBe("demo");
    expect(result.trip.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.trip.destination).toBe("重庆");
  });
});
