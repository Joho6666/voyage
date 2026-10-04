// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { validateTrip } from "@/schemas/trip";
import { clearRouteMatrixCache } from "@/services/brain/route-matrix";

// Each test creates full trips (provider + repository + routing), so the
// default 5s timeout is too tight for the two-trip cost-bound case.
vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Array<{ id: string; name: string; category: string; lat: number; lng: number }>;
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  routeCalls = 0;
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
    this.routeCalls += 1;
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

const BRAIN_INPUT = {
  destination: "重庆",
  startDate: "2030-05-01",
  days: 2,
  people: 2,
  budget: 2500,
  fallbackPolicy: "estimated" as const,
};

describe("createTrip Travel Brain gate (VOYAGE_BRAIN)", () => {
  let dataDir: string;
  let fixture: Fixture;
  const previousFlag = process.env.VOYAGE_BRAIN;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-brain-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
  });

  afterEach(async () => {
    if (previousFlag === undefined) delete process.env.VOYAGE_BRAIN;
    else process.env.VOYAGE_BRAIN = previousFlag;
    await rm(dataDir, { recursive: true, force: true });
  });

  function runtime() {
    return new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(fixture),
    );
  }

  it("adds brain metadata and uncertainty warnings when the flag is on", async () => {
    process.env.VOYAGE_BRAIN = "1";
    const created = await runtime().createTrip({ ...BRAIN_INPUT }) as { data: { trip: Trip; tripId: string }; warnings: string[] };
    const trip = created.data.trip;

    expect(validateTrip(trip).success).toBe(true);
    const brain = trip.planningMetadata?.brain;
    expect(brain?.version).toBe("4.1");
    expect(brain?.routeMatrix.realEdges).toBeGreaterThan(0);
    expect(brain?.routeMatrix.coverage).toBeGreaterThan(0);
    expect(brain?.constraintEvaluation.hardViolations).toHaveLength(0);
    expect(Array.isArray(brain?.repairs)).toBe(true);
    // Fixture places carry no opening hours: the gate must say so instead of guessing.
    expect(created.warnings.some((warning) => warning.includes("营业时间未知"))).toBe(true);
  });

  it("repairs a certain budget overrun and keeps the violation visible", async () => {
    process.env.VOYAGE_BRAIN = "1";
    const created = await runtime().createTrip({
      ...BRAIN_INPUT,
      budget: 1,
      planningProfile: {
        destination: "重庆",
        startDate: "2030-05-01",
        endDate: "2030-05-02",
        days: 2,
        travelers: 2,
        budget: 1,
        vibes: [],
        mustVisit: [],
        avoid: [],
        dietary: [],
        socialOptIn: false,
        includeExternalOffers: false,
      },
    }) as { data: { trip: Trip }; warnings: string[] };
    const trip = created.data.trip;
    const brain = trip.planningMetadata?.brain;
    expect(brain).toBeTruthy();
    // With a ¥1 budget the ticket floor is certainly exceeded: the gate either
    // repaired stops (visible) or still reports the violation — never silence.
    const budgetVisible = created.warnings.some((warning) => warning.includes("保底花费"));
    expect(budgetVisible || (brain?.repairs.length ?? 0) > 0).toBe(true);
  });

  it("keeps the trip untouched by brain when the flag is off", async () => {
    delete process.env.VOYAGE_BRAIN;
    const created = await runtime().createTrip({ ...BRAIN_INPUT }) as { data: { trip: Trip }; warnings: string[] };
    const trip = created.data.trip;
    expect(trip.planningMetadata?.brain).toBeUndefined();
    expect(created.warnings.some((warning) => warning.includes("Travel Brain"))).toBe(false);
    expect(created.warnings.some((warning) => warning.includes("营业时间未知"))).toBe(false);
    expect(validateTrip(trip).success).toBe(true);
  });

  it("bounds the realtime route cost to the baseline plus the matrix budget", async () => {
    process.env.VOYAGE_BRAIN = "1";
    clearRouteMatrixCache();
    const provider = new RealFixtureProvider(fixture);
    const brainRuntime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => provider,
    );
    const withBrain = await brainRuntime.createTrip({ ...BRAIN_INPUT }) as { data: { trip: Trip } };
    const brainCalls = provider.routeCalls;

    delete process.env.VOYAGE_BRAIN;
    provider.routeCalls = 0;
    const plainRuntime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => provider,
    );
    const plain = await plainRuntime.createTrip({ ...BRAIN_INPUT }) as { data: { trip: Trip } };
    const baselineCalls = provider.routeCalls;

    expect(brainCalls).toBeGreaterThan(0);
    // The matrix adds at most maxRealEdges (8) bounded queries on top of the
    // existing per-segment enrichment — and reuses its own measured routes
    // for enrichment whenever the geometry matches.
    expect(brainCalls).toBeLessThanOrEqual(baselineCalls + 8);
    expect(withBrain.data.trip.segments.length).toBe(plain.data.trip.segments.length);
  });
});
