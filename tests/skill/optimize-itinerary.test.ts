// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place, ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Place[];
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: Place["category"]; limit: number }) {
    return this.fixture.places
      .filter((candidate) => !input.category || candidate.category === input.category)
      .slice(0, input.limit)
      .map((candidate) => ({ ...candidate, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

describe("optimize-itinerary runtime command", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-opt-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(new JsonSkillRepository(dataDir), async () => new RealFixtureProvider(fixture));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function create() {
    return runtime.createTrip({
      origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 3, people: 2, budget: 2500,
      preferences: [], walkingTolerance: "low", fallbackPolicy: "estimated",
    }) as any;
  }

  it("rejects a stale revision before touching anything", async () => {
    const created = await create();
    await expect(runtime.optimizeItinerary({ tripId: created.data.tripId, expectedTripRevision: 999 })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });

  it("produces a proposal with a proposalToken and leaves the trip untouched until apply", async () => {
    const created = await create();
    const tripId = created.data.tripId as string;
    const revision = created.data.revision as number;
    const before = (await runtime.getTrip({ tripId }) as any).data.trip;

    const optimized = await runtime.optimizeItinerary({ tripId, expectedTripRevision: revision }) as any;
    expect(optimized.ok).toBe(true);
    const afterOptimize = (await runtime.getTrip({ tripId }) as any).data.trip;
    expect(afterOptimize).toEqual(before);

    if (optimized.data.changed === false) {
      // Already optimal for this trip shape; nothing else to prove here.
      expect(optimized.data.message).toBeTruthy();
      return;
    }
    expect(optimized.data.proposalId).toBeTruthy();
    expect(optimized.data.proposalToken).toBeTruthy();
    expect(Array.isArray(optimized.data.optimization.decisions)).toBe(true);

    const applied = await runtime.applyChange({
      tripId, proposalId: optimized.data.proposalId, expectedTripRevision: optimized.data.baseRevision,
      confirmed: true, proposalToken: optimized.data.proposalToken,
    }) as any;
    expect(applied.data.revision).toBe(optimized.data.baseRevision + 1);
    expect(applied.data.trip.items.length).toBe(before.items.length);
  });

  it("never reschedules completed items", async () => {
    const created = await create();
    const tripId = created.data.tripId as string;
    const revision = created.data.revision as number;
    const trip = created.data.trip;
    const doneItem = trip.items[0];
    await runtime.setItemStatus({ tripId, itemId: doneItem.id, status: "done", expectedTripRevision: revision });
    const bumped = (await runtime.getTrip({ tripId }) as any).data.revision as number;

    const optimized = await runtime.optimizeItinerary({ tripId, expectedTripRevision: bumped }) as any;
    if (optimized.data.changed === false) {
      const still = (await runtime.getTrip({ tripId }) as any).data.trip.items.find((item: any) => item.id === doneItem.id);
      expect(still.dayId).toBe(doneItem.dayId);
      return;
    }
    const applied = await runtime.applyChange({
      tripId, proposalId: optimized.data.proposalId, expectedTripRevision: optimized.data.baseRevision,
      confirmed: true, proposalToken: optimized.data.proposalToken,
    }) as any;
    const done = applied.data.trip.items.find((item: any) => item.id === doneItem.id);
    expect(done.status).toBe("done");
    expect(done.dayId).toBe(doneItem.dayId);
  });

  it("honestly reports when there is nothing to optimize", async () => {
    const created = await create();
    const tripId = created.data.tripId as string;
    let revision = created.data.revision as number;
    const trip = (await runtime.getTrip({ tripId }) as any).data.trip;
    for (const item of trip.items) {
      await runtime.setItemStatus({ tripId, itemId: item.id, status: "done", expectedTripRevision: revision });
      revision += 1;
    }
    const optimized = await runtime.optimizeItinerary({ tripId, expectedTripRevision: revision }) as any;
    expect(optimized.data.changed).toBe(false);
    expect(optimized.data.message).toContain("没有可重排");
  });
});
