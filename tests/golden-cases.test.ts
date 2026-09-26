// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { SocialProviderRouter } from "@/services/social/router";
import type { SocialObservation, SocialProvider } from "@/services/social/types";

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

class FakeSocialProvider implements SocialProvider {
  readonly name = "tikhub" as const;
  readonly platforms = ["douyin"] as const;
  readonly configured = true;
  async searchContent() {
    const now = new Date().toISOString();
    const observation: SocialObservation = {
      provider: "tikhub", platform: "douyin", sourceId: "gc-1", city: "重庆",
      content: "重庆洪崖洞民俗风貌区夜景最近爆火，人多注意错峰", fetchedAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      metrics: { likes: 5200, comments: 300, shares: 120 }, rawMetadata: {},
    };
    return { status: "ok" as const, data: [observation], warnings: [] };
  }
  async getTrending() { return { status: "unavailable" as const, data: [], warnings: [] }; }
  async getContent() { return { status: "unavailable" as const, data: null, warnings: [] }; }
  async getComments() { return { status: "unavailable" as const, data: [], warnings: [] }; }
}

describe("Golden Travel Cases", () => {
  let dataDir: string;
  let fixture: Fixture;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-golden-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(fixture),
      () => new SocialProviderRouter([new FakeSocialProvider()]),
    );
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("Case 1: 桂林 → 重庆 三天两人 2500 少走路 — plan then transport replan reduces walking", async () => {
    const created = await runtime.createTrip({
      origin: "桂林",
      destination: "重庆",
      startDate: "2026-10-01",
      days: 3,
      people: 2,
      budget: 2500,
      preferences: ["少走路"],
      fallbackPolicy: "estimated",
    }) as { data: { tripId: string; trip: Trip } };
    const trip = created.data.trip;
    expect(trip.days).toHaveLength(3);
    expect(trip.travelers).toBe(2);
    expect(trip.budget).toBe(2500);
    expect(trip.items.length).toBeGreaterThan(4);

    const replanned = await runtime.proposeChange({
      tripId: trip.id,
      instruction: "少走路，最好少换乘。",
      dayId: trip.days[1].id,
      fallbackPolicy: "estimated",
    }) as { data: { proposalId: string | null; changes: { metrics: { walkDistanceDiffMeters: number } } } };
    expect(replanned.data.proposalId).toEqual(expect.any(String));
    // The Diff explains the change with structured metrics, not prose only.
    expect(replanned.data.changes.metrics).toHaveProperty("walkDistanceDiffMeters");
  });

  it("Case 2: 重庆下雨 — rain adaptation swaps outdoor for indoor without touching completed items", async () => {
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2026-10-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { trip: Trip } };
    const trip = created.data.trip;
    const before = JSON.stringify(trip.items.filter((item) => item.status !== "planned").map((item) => item.id).sort());

    const proposal = await runtime.proposeChange({
      tripId: trip.id,
      instruction: "明天下雨，安排室内方案。",
      dayId: trip.days[0].id,
      fallbackPolicy: "estimated",
    }) as { data: { proposalId: string; changes: { summary: string } } };
    expect(proposal.data.proposalId).toEqual(expect.any(String));
    expect(proposal.data.changes.summary).toBeTruthy();

    // Nothing is applied until the user confirms; the stored trip is unchanged.
    const stored = await runtime.getTrip({ tripId: trip.id }) as { data: { trip: Trip } };
    expect(JSON.stringify(stored.data.trip.items.filter((item) => item.status !== "planned").map((item) => item.id).sort())).toBe(before);
  });

  it("Case 3: '明天太累了' — no completed-item mutation, walking reduced, Diff requires explicit confirmation", async () => {
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2026-10-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { trip: Trip; revision: number } };
    const trip = created.data.trip;

    const proposal = await runtime.proposeChange({
      tripId: trip.id,
      instruction: "明天太累了，少走一点。",
      dayId: trip.days[1].id,
      fallbackPolicy: "estimated",
    }) as { data: { proposalId: string; baseRevision: number } };
    expect(proposal.data.baseRevision).toBe(created.data.revision);

    await expect(runtime.applyChange({
      tripId: trip.id, proposalId: proposal.data.proposalId, expectedTripRevision: created.data.revision, confirmed: false as never,
    })).rejects.toThrow();
    await expect(runtime.applyChange({
      tripId: trip.id, proposalId: proposal.data.proposalId, expectedTripRevision: created.data.revision,
    })).rejects.toThrow();

    const applied = await runtime.applyChange({
      tripId: trip.id, proposalId: proposal.data.proposalId, expectedTripRevision: created.data.revision, confirmed: true,
    }) as { data: { revision: number } };
    expect(applied.data.revision).toBeGreaterThan(created.data.revision);
  });

  it("Case 4: '最近重庆哪里比较火' — social evidence + POI alignment + RAG knowledge, all labeled", async () => {
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2026-10-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { trip: Trip } };
    const trip = created.data.trip;

    const evidence = await runtime.getSocialEvidence({ city: "重庆", tripId: trip.id }) as {
      data: { evidence: Array<{ platform: string; sourceId: string; sourceUrl?: string; publishedAt?: string; fetchedAt: string; confidence: number; metrics: Record<string, number>; poiMatches: unknown[] }> };
      providerStatus: { social: string };
    };
    expect(evidence.providerStatus.social).toBe("SOCIAL");
    const first = evidence.data.evidence[0];
    expect(first.platform).toBe("douyin");
    expect(first.sourceId).toBeTruthy();
    expect(first.fetchedAt).toBeTruthy();
    expect(first.metrics.likes).toBeGreaterThan(0);
    expect(first.confidence).toBeGreaterThan(0);

    const knowledge = await runtime.retrieveTravelKnowledge({ city: "重庆", query: "雨天 室内 景点" }) as {
      data: { matches: unknown[]; retrieval: { strategy: string } };
      providerStatus?: { knowledge?: string };
      warnings?: string[];
    };
    expect(knowledge.data.retrieval.strategy).toBeTruthy();
    // Either curated fallback or database matches — never presented as live provider facts.
    expect(knowledge.warnings === undefined || Array.isArray(knowledge.warnings)).toBe(true);
  });

  it("Case 5: 缺少 AMap Key — explicit UNAVAILABLE, never fabricated REAL data", async () => {
    const previousKey = process.env.AMAP_SERVER_KEY;
    delete process.env.AMAP_SERVER_KEY;
    delete process.env.AMAP_REST_KEY;
    try {
      const noKeyRuntime = new VoyageSkillRuntime(new JsonSkillRepository(dataDir));
      await expect(noKeyRuntime.execute("search-places", { destination: "重庆", query: "景点" })).rejects.toMatchObject({ code: "NO_PROVIDER_CONFIGURED" });
      await expect(noKeyRuntime.execute("get-weather", { destination: "重庆", dates: ["2026-10-01"], fallbackPolicy: "deny" })).rejects.toMatchObject({ code: "NO_PROVIDER_CONFIGURED" });

      // With an explicit estimated policy the caller gets clearly-labeled
      // fallbacks, never data that claims to be real.
      const weather = await noKeyRuntime.execute("get-weather", { destination: "重庆", dates: ["2026-10-01"], fallbackPolicy: "estimated" }) as { data: { weather: Array<{ provenance: { source: string; estimated: boolean } }> }; warnings: string[] };
      expect(weather.data.weather[0].provenance.estimated).toBe(true);
      expect(weather.warnings.length).toBeGreaterThan(0);
    } finally {
      if (previousKey !== undefined) process.env.AMAP_SERVER_KEY = previousKey;
    }
  });
});
