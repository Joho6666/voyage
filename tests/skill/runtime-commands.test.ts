// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Place, Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { outputSchemas } from "@/skill/contracts";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import type { SocialObservation, SocialProvider } from "@/services/social/types";
import { SocialProviderRouter } from "@/services/social/router";

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
      .filter((place) => !input.category || place.category === input.category)
      .slice(0, input.limit)
      .map((place) => ({ ...place, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

function socialObservation(partial: Partial<SocialObservation> & { sourceId: string; content: string }): SocialObservation {
  const now = new Date();
  return {
    provider: "tikhub",
    platform: "douyin",
    city: "重庆",
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    metrics: {},
    rawMetadata: {},
    ...partial,
  };
}

class FakeSocialProvider implements SocialProvider {
  readonly name = "tikhub" as const;
  readonly platforms = ["douyin", "xiaohongshu"] as const;
  readonly configured = true;
  constructor(private readonly observations: SocialObservation[]) {}

  async searchContent() {
    return { status: "ok" as const, data: this.observations, warnings: [] };
  }

  async getTrending() {
    return { status: "ok" as const, data: this.observations, warnings: [] };
  }

  async getContent() {
    return { status: "ok" as const, data: this.observations[0] ?? null, warnings: [] };
  }

  async getComments() {
    return { status: "ok" as const, data: [], warnings: [] };
  }
}

class UnconfiguredSocialProvider implements SocialProvider {
  readonly name = "tikhub" as const;
  readonly platforms = ["douyin"] as const;
  readonly configured = false;
  async searchContent() { return { status: "unavailable" as const, data: [], warnings: ["tikhub is not configured"] }; }
  async getTrending() { return { status: "unavailable" as const, data: [], warnings: ["tikhub is not configured"] }; }
  async getContent() { return { status: "unavailable" as const, data: null, warnings: ["tikhub is not configured"] }; }
  async getComments() { return { status: "unavailable" as const, data: [], warnings: ["tikhub is not configured"] }; }
}

async function expectEnvelopeSchema(command: keyof typeof outputSchemas, envelope: { data?: unknown }) {
  const parsed = outputSchemas[command].safeParse(envelope.data);
  if (!parsed.success) throw new Error(`${command} output schema mismatch: ${parsed.error.message}`);
}

describe("Voyage runtime unified commands", () => {
  let dataDir: string;
  let fixture: Fixture;
  let repository: JsonSkillRepository;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-runtime-commands-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => new RealFixtureProvider(fixture));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function seedTrip() {
    const envelope = await runtime.createTrip({
      destination: "重庆",
      startDate: "2026-10-01",
      days: 2,
      people: 2,
      budget: 2500,
      fallbackPolicy: "estimated",
    }) as { data: { tripId: string; trip: Trip; revision: number } };
    return envelope.data;
  }

  it("get-place resolves a place from the trip and from provider search", async () => {
    const { trip } = await seedTrip();
    const place = trip.places[0];
    const byId = await runtime.execute("get-place", { tripId: trip.id, placeId: place.id }) as { data: { place: Place; matchBasis: string } };
    expect(byId.data.place.id).toBe(place.id);
    expect(byId.data.matchBasis).toBe("trip_lookup");
    await expectEnvelopeSchema("get-place", byId);

    const byName = await runtime.execute("get-place", { name: fixture.places[0].name, city: "重庆" }) as { data: { place: Place; matchBasis: string } };
    expect(byName.data.matchBasis).toBe("provider_search");
    expect(byName.data.place.name).toBe(fixture.places[0].name);
  });

  it("update-trip patches safe fields, recomputes budget, and enforces revision lock", async () => {
    const { trip, revision } = await seedTrip();
    const updated = await runtime.execute("update-trip", {
      tripId: trip.id,
      expectedTripRevision: revision,
      patch: { title: "重庆精简两日", budget: 1800 },
    }) as { data: { trip: Trip; revision: number; changedFields: string[] } };
    expect(updated.data.trip.title).toBe("重庆精简两日");
    expect(updated.data.trip.budget).toBe(1800);
    expect(updated.data.changedFields).toEqual(["title", "budget"]);
    expect(updated.data.revision).toBeGreaterThan(revision);
    await expectEnvelopeSchema("update-trip", updated);

    await expect(runtime.execute("update-trip", {
      tripId: trip.id,
      expectedTripRevision: revision,
      patch: { title: "stale" },
    })).rejects.toThrow();
  });

  it("search-social returns verifiable evidence with metrics; alignment stays unknown without trip context", async () => {
    const { trip } = await seedTrip();
    const poi = trip.places.find((place) => place.name.includes("洪崖洞")) ?? trip.places[0];
    const observations = [
      socialObservation({ sourceId: "dy-1", content: `${poi.name} 人多得走不动`, metrics: { likes: 1200, comments: 88, shares: 40 }, entityId: poi.id }),
      socialObservation({ sourceId: "dy-2", platform: "xiaohongshu", content: `${poi.name} 夜景值得`, publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), metrics: { likes: 30 } }),
      socialObservation({ sourceId: "dy-3", content: "成都火锅店探店完全无关内容", metrics: { likes: 999 } }),
    ];
    const socialRuntime = new VoyageSkillRuntime(repository, async () => new RealFixtureProvider(fixture), () => new SocialProviderRouter([new FakeSocialProvider(observations)]));
    const envelope = await socialRuntime.execute("search-social", { city: "重庆", poi: poi.name }) as {
      data: { evidence: Array<{ sourceId: string; metrics: Record<string, number>; poiMatches?: unknown[] }> };
      providerStatus: { social: string; overall: string };
      generatedAt: string;
    };
    expect(envelope.data.evidence).toHaveLength(2);
    expect(envelope.data.evidence.every((item) => item.metrics && typeof item.metrics === "object")).toBe(true);
    expect(envelope.providerStatus.social).toBe("SOCIAL");
    expect(envelope.generatedAt).toBeTruthy();
    await expectEnvelopeSchema("search-social", envelope);
  });

  it("get-social-evidence aligns evidence to trip POIs by entity id", async () => {
    const { trip } = await seedTrip();
    const poi = trip.places.find((place) => place.name.includes("洪崖洞")) ?? trip.places[0];
    const observations = [
      socialObservation({ sourceId: "dy-1", content: `${poi.name} 人多得走不动`, metrics: { likes: 1200 }, entityId: poi.id }),
      socialObservation({ sourceId: "dy-2", content: `路过${poi.name}附近`, metrics: { likes: 40 } }),
    ];
    const socialRuntime = new VoyageSkillRuntime(repository, async () => new RealFixtureProvider(fixture), () => new SocialProviderRouter([new FakeSocialProvider(observations)]));
    const envelope = await socialRuntime.execute("get-social-evidence", { city: "重庆", poi: poi.name, tripId: trip.id }) as {
      data: { evidence: Array<{ sourceId: string; poiMatches: Array<{ placeId: string; matchBasis: string; confidence: number }> }>; context: { crowdRisk: string } };
    };
    const aligned = envelope.data.evidence.find((item) => item.sourceId === "dy-1");
    expect(aligned?.poiMatches[0]).toMatchObject({ placeId: poi.id, matchBasis: "entity_id" });
    const nameAligned = envelope.data.evidence.find((item) => item.sourceId === "dy-2");
    expect(nameAligned?.poiMatches[0]).toMatchObject({ placeId: poi.id, matchBasis: "name_contains" });
    expect(envelope.data.context).toBeDefined();
    await expectEnvelopeSchema("get-social-evidence", envelope);
  });

  it("get-social-trending ranks by engagement and get-social-evidence exposes context", async () => {
    const observations = [
      socialObservation({ sourceId: "low", content: "重庆小面打卡", metrics: { likes: 5 } }),
      socialObservation({ sourceId: "high", content: "重庆长江索道爆火", metrics: { likes: 9000, comments: 500, shares: 300 } }),
    ];
    const socialRuntime = new VoyageSkillRuntime(repository, async () => new RealFixtureProvider(fixture), () => new SocialProviderRouter([new FakeSocialProvider(observations)]));

    const trending = await socialRuntime.execute("get-social-trending", { city: "重庆" }) as { data: { evidence: Array<{ sourceId: string }> } };
    expect(trending.data.evidence[0]?.sourceId).toBe("high");
    await expectEnvelopeSchema("get-social-trending", trending);

    const evidenceEnvelope = await socialRuntime.execute("get-social-evidence", { city: "重庆", poi: "长江索道" }) as { data: { context: { crowdRisk: string }; evidence: unknown[] } };
    expect(evidenceEnvelope.data.context).toBeDefined();
    expect(Array.isArray(evidenceEnvelope.data.evidence)).toBe(true);
    await expectEnvelopeSchema("get-social-evidence", evidenceEnvelope);
  });

  it("marks social commands UNAVAILABLE when no provider is configured instead of faking data", async () => {
    const socialRuntime = new VoyageSkillRuntime(repository, async () => new RealFixtureProvider(fixture), () => new SocialProviderRouter([new UnconfiguredSocialProvider()]));
    const envelope = await socialRuntime.execute("search-social", { city: "重庆" }) as { data: { evidence: unknown[] }; providerStatus: { social: string }; warnings: string[] };
    expect(envelope.data.evidence).toHaveLength(0);
    expect(envelope.providerStatus.social).toBe("UNAVAILABLE");
    expect(envelope.warnings.length).toBeGreaterThan(0);
  });
});
