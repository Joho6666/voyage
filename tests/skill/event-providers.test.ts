// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { MockTravelEventProvider, weatherEventProvider, flightEventProvider } from "@/skill/event-providers";

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Array<{ id: string; name: string; category: string; lat: number; lng: number }>;
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: string; limit: number }) {
    return this.fixture.places
      .filter((place) => !input.category || place.category === input.category)
      .slice(0, input.limit)
      .map((place) => ({ ...place, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } })) as never;
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

describe("event providers (Phase 6.8)", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;
  let tripId: string;
  let revision: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-providers-"));
    const fixture = JSON.parse(await readFile0()) as Fixture;
    runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(fixture),
    );
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { tripId: string; revision: number; trip: Trip } };
    tripId = created.data.tripId;
    revision = created.data.revision;
  });

  async function readFile0() {
    const { readFile } = await import("node:fs/promises");
    return readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8");
  }

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("weather normalization maps conditions to typed events with honest severity", () => {
    const rain = weatherEventProvider.normalize({ date: "2030-05-02", condition: "暴雨", tempC: 21, fetchedAt: "2030-05-01T00:00:00Z" }, {} as Trip);
    expect(rain.type).toBe("HEAVY_RAIN");
    const drizzle = weatherEventProvider.normalize({ date: "2030-05-02", condition: "小雨", tempC: 21, fetchedAt: "2030-05-01T00:00:00Z" }, {} as Trip);
    expect(drizzle.type).toBe("WEATHER_CHANGED");
    const heat = weatherEventProvider.normalize({ date: "2030-05-02", condition: "高温", tempC: 39, fetchedAt: "2030-05-01T00:00:00Z" }, {} as Trip);
    expect(heat.type).toBe("EXTREME_HEAT");
  });

  it("flight normalization turns delayed/cancelled statuses into critical events", () => {
    const delayed = flightEventProvider.normalize({ flightNo: "CA1468", status: "delayed", delayMinutes: 83, provider: "test", fetchedAt: "2030-05-01T00:00:00Z", confidence: 0.95 }, {} as Trip, "r-1");
    expect(delayed.type).toBe("FLIGHT_DELAYED");
    expect(delayed.relatedEntities).toContainEqual({ kind: "reservation", id: "r-1" });
    const cancelled = flightEventProvider.normalize({ flightNo: "CA1468", status: "cancelled", provider: "test", fetchedAt: "2030-05-01T00:00:00Z", confidence: 0.95 }, {} as Trip);
    expect(cancelled.type).toBe("FLIGHT_CANCELLED");
  });

  it("records a simulated incident labeled as simulation — never provider data", async () => {
    process.env.VOYAGE_DEMO_MODE = "true";
    try {
      const response = await runtime.execute("simulate-travel-event", {
        tripId, expectedTripRevision: revision, incident: "flight_delay", delayMinutes: 82,
      }) as { data: { event: { provenance: { source: string; confidence: number }; payload: Record<string, unknown> } }; warnings: string[] };
      expect(response.data.event.provenance.source).toBe("simulation");
      expect(response.data.event.provenance.confidence).toBe(1);
      expect(response.warnings.some((warning) => warning.includes("模拟"))).toBe(true);
    } finally {
      delete process.env.VOYAGE_DEMO_MODE;
    }
  });

  it("refuses simulation outside demo mode", async () => {
    delete process.env.VOYAGE_DEMO_MODE;
    await expect(runtime.execute("simulate-travel-event", {
      tripId, expectedTripRevision: revision, incident: "heavy_rain",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("simulated rain feeds the full analyze → replan chain", async () => {
    process.env.VOYAGE_DEMO_MODE = "true";
    try {
      const simulated = await runtime.execute("simulate-travel-event", {
        tripId, expectedTripRevision: revision, incident: "heavy_rain", date: "2030-05-01",
      }) as { data: { event: { id: string }; revision: number } };

      const impact = await runtime.execute("analyze-event-impact", {
        tripId, eventId: simulated.data.event.id,
      }) as { data: { impact: { eventType: string; recommendedStrategy: string } } };
      expect(impact.data.impact.eventType).toBe("HEAVY_RAIN");

      const proposal = await runtime.execute("propose-event-replan", {
        tripId, eventId: simulated.data.event.id, strategy: "indoorSwap", fallbackPolicy: "estimated",
      }) as { data: { proposalId: string | null; actions: Array<{ type: string }> } };
      expect(proposal.data.proposalId).toEqual(expect.any(String));
      expect(proposal.data.actions.some((action) => action.type === "RAIN_PLAN")).toBe(true);
    } finally {
      delete process.env.VOYAGE_DEMO_MODE;
    }
  });

  it("mock provider emits the documented incident catalogue", () => {
    const mock = new MockTravelEventProvider();
    expect(mock.flightDelay("CA1468", 82).type).toBe("FLIGHT_DELAYED");
    expect(mock.heavyRain("2030-05-02").type).toBe("HEAVY_RAIN");
    expect(mock.poiClosed("p-1", "2030-05-02").relatedEntities[0]).toEqual({ kind: "place", id: "p-1" });
    expect(mock.userLate(45, "2030-05-02").payload.minutes).toBe(45);
    expect(mock.roadCongested("seg-1", "2030-05-02").type).toBe("ROAD_CONGESTED");
  });
});
