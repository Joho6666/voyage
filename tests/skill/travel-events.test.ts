// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TravelEvent } from "@/schemas/travel-event";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { validateTrip } from "@/schemas/trip";

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

const RAIN = {
  type: "HEAVY_RAIN" as const,
  severity: "warning" as const,
  effectiveFrom: "2030-05-01T14:00:00+08:00",
  effectiveUntil: "2030-05-01T18:00:00+08:00",
  summary: "14:00 起暴雨，预计 18:00 转小",
  payload: { condition: "暴雨", confidence: 0.9 },
};

const FLIGHT_DELAY = {
  type: "FLIGHT_DELAYED" as const,
  severity: "critical" as const,
  source: "provider" as const,
  summary: "回程航班延误 90 分钟",
  payload: { delayMinutes: 90, flightNo: "CA1468" },
  relatedEntities: [{ kind: "reservation" as const, id: "r-flight" }],
};

describe("travel event model (Phase 6.3)", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;
  let tripId: string;
  let revision: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-events-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(fixture),
    );
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { tripId: string; revision: number } };
    tripId = created.data.tripId;
    revision = created.data.revision;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("records a normalized event with runtime-owned id/provenance and persists it", async () => {
    const response = await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision, event: RAIN,
    }) as { ok: boolean; data: { event: TravelEvent; total: number; revision: number } };

    expect(response.ok).toBe(true);
    expect(response.data.event.id).toMatch(/^evt_/);
    expect(response.data.event.occurredAt).toBe(RAIN.effectiveFrom);
    expect(response.data.event.provenance.source).toBe("system");
    expect(response.data.event.provenance.fetchedAt).toBeTruthy();
    expect(response.data.total).toBe(1);

    const stored = await runtime.getTrip({ tripId }) as { data: { trip: { travelEvents?: TravelEvent[] } } };
    expect(stored.data.trip.travelEvents).toHaveLength(1);
    expect(validateTrip(stored.data.trip).success).toBe(true);
  });

  it("keeps the caller's declared source (never masquerades as provider data)", async () => {
    const response = await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision, event: { ...RAIN, source: "user" as const, confidence: 0.8, estimated: true },
    }) as { data: { event: TravelEvent } };
    expect(response.data.event.provenance.source).toBe("user");
    expect(response.data.event.provenance.estimated).toBe(true);
    expect(response.data.event.provenance.confidence).toBeCloseTo(0.8);
  });

  it("rejects forged ids and stale revisions", async () => {
    await expect(runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision + 9, event: RAIN,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    // The strict input schema rejects runtime-owned fields outright.
    await expect(runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision, event: { ...RAIN, id: "forged" },
    })).rejects.toThrow();
  });

  it("returns only events active at the requested instant", async () => {
    const recorded = await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision, event: RAIN,
    }) as { data: { revision: number } };

    // Before the rain window: not active yet.
    const before = await runtime.execute("get-active-events", {
      tripId, asOf: "2030-05-01T08:00:00+08:00",
    }) as { data: { total: number } };
    expect(before.data.total).toBe(0);

    // Inside the window: active.
    const during = await runtime.execute("get-active-events", {
      tripId, asOf: "2030-05-01T15:00:00+08:00",
    }) as { data: { total: number; events: TravelEvent[] } };
    expect(during.data.total).toBe(1);
    expect(during.data.events[0].type).toBe("HEAVY_RAIN");

    // After the window: expired.
    const after = await runtime.execute("get-active-events", {
      tripId, asOf: "2030-05-01T19:00:00+08:00",
    }) as { data: { total: number } };
    expect(after.data.total).toBe(0);

    void recorded;
  });

  it("an event without an effective window stays active until acknowledged", async () => {
    await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision, event: FLIGHT_DELAY,
    }) as { data: { revision: number } };

    const active = await runtime.execute("get-active-events", {
      tripId, asOf: "2030-05-02T12:00:00+08:00",
    }) as { data: { total: number } };
    expect(active.data.total).toBe(1);

    const acknowledged = await runtime.execute("get-active-events", {
      tripId, asOf: "2030-05-02T12:00:00+08:00", includeAcknowledged: true,
    }) as { data: { total: number } };
    expect(acknowledged.data.total).toBe(1);
  });
});
