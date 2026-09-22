// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateTrip } from "@/schemas/trip";
import type { Place, Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";

interface Fixture {
  places: Place[];
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  failRoutes = false;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: Place["category"]; limit: number }) {
    return this.fixture.places
      .filter((place) => !input.category || place.category === input.category)
      .slice(0, input.limit)
      .map((place) => ({ ...place, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    if (this.failRoutes) throw new Error("fixture route failure");
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

describe("Voyage Skill runtime", () => {
  let dataDir: string;
  let fixture: Fixture;
  let provider: RealFixtureProvider;
  let repository: JsonSkillRepository;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-skill-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    provider = new RealFixtureProvider(fixture);
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => provider);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function create() {
    return runtime.createTrip({
      origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 3, people: 2, budget: 2500,
      preferences: ["美食", "夜景", "少走路"], walkingTolerance: "low", fallbackPolicy: "deny",
    }) as Promise<any>;
  }

  it("creates the Guilin to Chongqing golden trip from provider facts", async () => {
    const response = await create();
    const trip = response.data.trip as Trip;
    expect(validateTrip(trip).success).toBe(true);
    expect(trip.days).toHaveLength(3);
    expect(trip.travelers).toBe(2);
    expect(trip.budget).toBe(2500);
    expect(trip.places.length).toBeGreaterThan(4);
    expect(trip.places.every((place) => place.source === "amap" && Number.isFinite(place.lat) && Number.isFinite(place.lng))).toBe(true);
    expect(trip.segments.length).toBeGreaterThan(0);
    expect(trip.segments.every((segment) => segment.provider === "amap" && !segment.estimated)).toBe(true);
    expect(trip.days.map((day) => day.weather.condition)).toEqual(["多云", "中雨", "晴"]);
    expect(response.providerStatus.overall).toBe("REAL");
  });

  it("uses explicit estimated route fallback and preserves provenance", async () => {
    provider.failRoutes = true;
    const response = await runtime.createTrip({
      origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 3, people: 2, budget: 2500,
      preferences: [], fallbackPolicy: "estimated",
    }) as any;
    expect(response.providerStatus.routes).toBe("ESTIMATED");
    expect(response.data.trip.segments.every((segment: any) => segment.provider === "haversine" && segment.estimated)).toBe(true);
    expect(response.warnings.length).toBeGreaterThan(0);
  });

  it("targets Day 2 and does not mutate Day 1 before apply", async () => {
    const created = await create();
    const trip = created.data.trip as Trip;
    const before = structuredClone(trip);
    const proposal = await runtime.proposeChange({ tripId: trip.id, instruction: "第二天太累了，少走一点。", fallbackPolicy: "estimated" }) as any;
    const changes = proposal.data.changes;
    const day1 = trip.days[0].id;
    expect(changes.actions.every((action: any) => action.payload.dayId === trip.days[1].id)).toBe(true);
    expect(changes.proposedTrip.items.filter((item: any) => item.dayId === day1)).toEqual(before.items.filter((item) => item.dayId === day1));
    expect(changes.metrics).toHaveProperty("walkDistanceBeforeMeters");
    expect((await repository.getTrip(trip.id))?.trip).toEqual(before);
  });

  it("preserves completed/current items during rain adaptation", async () => {
    const created = await create();
    const trip = structuredClone(created.data.trip) as Trip;
    const day2 = trip.days[1];
    const dayItems = trip.items.filter((item) => item.dayId === day2.id).sort((a, b) => a.order - b.order);
    dayItems[0].status = "done";
    dayItems[1].status = "current";
    dayItems[2].placeId = "p-ciqikou";
    const isolatedDir = await mkdtemp(path.join(os.tmpdir(), "voyage-rain-"));
    try {
      const isolatedRepo = new JsonSkillRepository(isolatedDir);
      await isolatedRepo.createTrip(trip);
      const isolatedRuntime = new VoyageSkillRuntime(isolatedRepo, async () => provider);
      const proposal = await isolatedRuntime.proposeChange({
        tripId: trip.id,
        instruction: "今天下午下雨了，把后面的露天行程换成室内。",
        asOf: "2030-05-02T05:00:00.000Z",
        fallbackPolicy: "estimated",
      }) as any;
      const proposed = proposal.data.changes.proposedTrip as Trip;
      expect(proposed.items.find((item) => item.id === dayItems[0].id)).toEqual(dayItems[0]);
      expect(proposed.items.find((item) => item.id === dayItems[1].id)).toEqual(dayItems[1]);
      const changed = proposed.items.find((item) => item.id === dayItems[2].id)!;
      expect(changed.placeId).not.toBe(dayItems[2].placeId);
      expect(proposed.places.find((place) => place.id === changed.placeId)?.tags).toContain("室内");
      expect(proposal.data.changes.itemChanges.some((change: any) => change.type === "replaced")).toBe(true);
    } finally {
      await rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it("requires confirmation, applies once, and rejects stale proposals", async () => {
    const created = await create();
    const tripId = created.data.tripId as string;
    const first = await runtime.proposeChange({ tripId, instruction: "第二天少走一点", fallbackPolicy: "estimated" }) as any;
    const second = await runtime.proposeChange({ tripId, instruction: "第二天省100元", fallbackPolicy: "estimated" }) as any;
    await expect(runtime.applyChange({ tripId, proposalId: first.data.proposalId, expectedTripRevision: 1, confirmed: false })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const applied = await runtime.applyChange({ tripId, proposalId: first.data.proposalId, expectedTripRevision: 1, confirmed: true }) as any;
    expect(applied.data.revision).toBe(2);
    await expect(runtime.applyChange({ tripId, proposalId: first.data.proposalId, expectedTripRevision: 1, confirmed: true })).rejects.toMatchObject({ code: "PROPOSAL_ALREADY_APPLIED" });
    await expect(runtime.applyChange({ tripId, proposalId: second.data.proposalId, expectedTripRevision: 1, confirmed: true })).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
  });

  it("fails real mode explicitly when no AMap key exists", async () => {
    const previous = process.env.AMAP_SERVER_KEY;
    delete process.env.AMAP_SERVER_KEY;
    try {
      const noProvider = new VoyageSkillRuntime(new JsonSkillRepository(dataDir));
      await expect(noProvider.searchPlaces({ destination: "重庆", query: "景点" })).rejects.toMatchObject({ code: "NO_PROVIDER_CONFIGURED" });
    } finally {
      if (previous) process.env.AMAP_SERVER_KEY = previous;
    }
  });

  it("emits one JSON envelope from the cross-platform CLI", async () => {
    const inputFile = path.join(dataDir, "input.json");
    await writeFile(inputFile, JSON.stringify({ destination: "重庆", query: "景点", limit: 3 }), "utf8");
    const result = spawnSync(process.execPath, ["skills/voyage/scripts/voyage.mjs", "search-places", "--input", inputFile], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, VOYAGE_ALLOW_MOCK: "1", VOYAGE_PROVIDER_FIXTURE: path.resolve("tests/fixtures/voyage-provider.json"), VOYAGE_DATA_DIR: dataDir },
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.schemaVersion).toBe("voyage.skill.v1");
    expect(output.ok).toBe(true);
    expect(output.providerStatus.overall).toBe("MOCK");
  });

  it("keeps the runtime independent of UI and browser globals", async () => {
    const files = ["src/skill/runtime.ts", "src/skill/repository.ts", "src/skill/providers.ts", "src/skill/cli.ts"];
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(/from ["']react|zustand|localStorage|\bwindow\b/);
  });
});
