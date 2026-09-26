// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { SocialProviderRouter } from "@/services/social/router";
import type { SocialProvider } from "@/services/social/provider";
import type { SocialObservation, SocialPlatform } from "@/services/social/types";
import type { Place, Trip } from "@/types/travel";

interface Fixture {
  places: Place[];
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class FixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;

  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { category?: Place["category"]; limit: number }) {
    return this.fixture.places
      .filter((place) => !input.category || place.category === input.category)
      .slice(0, input.limit)
      .map((place) => ({
        ...place,
        source: "amap" as const,
        provenance: { source: "amap" as const, estimated: false as const },
      }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

class RecordingSocialProvider implements SocialProvider {
  readonly name = "tikhub" as const;
  readonly platforms = ["douyin", "xiaohongshu", "weibo", "wechat_search"] as const;
  readonly configured = true;
  readonly calls: SocialPlatform[] = [];

  async searchContent(input: { city: string; platform?: SocialPlatform }) {
    const platform = input.platform ?? "douyin";
    this.calls.push(platform);
    const fetchedAt = new Date().toISOString();
    const observation: SocialObservation = {
      provider: "tikhub",
      platform,
      sourceId: `${platform}-source-1`,
      sourceUrl: `https://example.com/${platform}/source-1`,
      city: input.city,
      content: `${input.city} 洪崖洞晚间排队很多，建议错峰`,
      publishedAt: fetchedAt,
      fetchedAt,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      metrics: { likes: 500, comments: 40 },
      rawMetadata: {},
    };
    return { status: "ok" as const, data: [observation], warnings: [] };
  }

  async getTrending() {
    return { status: "unavailable" as const, data: [], warnings: [] };
  }

  async getContent() {
    return { status: "unavailable" as const, data: null, warnings: [] };
  }

  async getComments() {
    return { status: "unavailable" as const, data: [], warnings: [] };
  }
}

describe("Voyage runtime social planning provenance", () => {
  let dataDir: string;
  let fixture: Fixture;
  let repository: JsonSkillRepository;
  let socialProvider: RecordingSocialProvider;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-runtime-social-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    repository = new JsonSkillRepository(dataDir);
    socialProvider = new RecordingSocialProvider();
    runtime = new VoyageSkillRuntime(
      repository,
      async () => new FixtureProvider(fixture),
      () => new SocialProviderRouter([socialProvider]),
    );
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const input = {
    destination: "重庆",
    startDate: "2030-05-01",
    days: 2,
    people: 2,
    budget: 2500,
    prompt: "想看夜景并避开拥挤时段",
    fallbackPolicy: "estimated" as const,
  };

  it("does not query social providers unless the caller opts in", async () => {
    const response = await runtime.createTrip({ ...input, includeSocialEvidence: false }) as {
      data: { trip: Trip };
      providerStatus: { social: string };
    };

    expect(socialProvider.calls).toEqual([]);
    expect(response.data.trip.socialQueryStatus).toBe("not_requested");
    expect(response.data.trip.socialPlatformStatus).toBeUndefined();
    expect(response.data.trip.socialEvidence).toBeUndefined();
    expect(response.data.trip.planningMetadata).toMatchObject({
      source: "rules",
      llm: "skipped",
      social: "not_requested",
    });
    expect(response.providerStatus.social).toBe("UNKNOWN");
  });

  it("persists provider evidence and reports queried-but-not-used during rule planning", async () => {
    const response = await runtime.createTrip({ ...input, includeSocialEvidence: true }) as {
      data: { tripId: string; trip: Trip };
      providerStatus: { social: string };
    };
    const trip = response.data.trip;
    const stored = await repository.getTrip(response.data.tripId);

    expect(socialProvider.calls).toEqual(["douyin", "xiaohongshu", "weibo", "wechat_search"]);
    expect(trip.socialQueryStatus).toBe("queried_not_used");
    expect(trip.planningMetadata).toMatchObject({
      source: "rules",
      llm: "skipped",
      social: "queried_not_used",
    });
    expect(trip.socialPlatformStatus).toEqual({
      douyin: "ok",
      xiaohongshu: "ok",
      weibo: "ok",
      wechat_search: "ok",
    });
    expect(trip.socialEvidence).toHaveLength(4);
    expect(trip.socialEvidence?.[0]).toMatchObject({ provider: "tikhub", sampleSize: 4 });
    expect(trip.socialEvidence?.every((evidence) => Boolean(evidence.sourceUrl && evidence.expiresAt))).toBe(true);
    expect(response.providerStatus.social).toBe("SOCIAL");
    expect(stored?.trip.socialEvidence?.[0]).toMatchObject({ provider: "tikhub" });
    expect(stored?.trip.socialPlatformStatus).toEqual(trip.socialPlatformStatus);
  });
});
