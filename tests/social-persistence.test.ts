// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import { JsonSkillRepository } from "@/skill/repository";
import type { Trip } from "@/types/travel";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("social evidence persistence", () => {
  it("preserves provider, expiry, platform status, signals, and planning metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voyage-social-trip-"));
    roots.push(root);
    const repository = new JsonSkillRepository(root);
    const now = new Date("2030-05-01T08:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
    const trip = structuredClone(chongqingTrip) as Trip;
    trip.socialQueryId = "query-social-1";
    trip.socialQueryStatus = "used";
    trip.socialPlatformStatus = { douyin: "ok", xiaohongshu: "unavailable" };
    trip.socialEvidence = [{
      provider: "tikhub",
      platform: "douyin",
      sourceId: "aweme-1",
      sourceUrl: "https://example.com/aweme-1",
      summary: "重庆洪崖洞晚间排队较多",
      city: "重庆",
      publishedAt: now.toISOString(),
      fetchedAt: now.toISOString(),
      expiresAt,
      signalTypes: ["crowd_risk"],
      confidence: 0.6,
      sampleSize: 1,
      metrics: { likes: 200 },
      poiMatches: [{ placeId: trip.places[0].id, name: trip.places[0].name, confidence: 0.5, matchBasis: "name_contains" }],
      warnings: ["仅作攻略参考"],
    }];
    trip.socialSignals = [{
      id: "signal-1",
      city: "重庆",
      signalType: "crowd_risk",
      value: { risk: 0.8 },
      confidence: 0.6,
      sampleSize: 1,
      platformCount: 1,
      observedAt: now.toISOString(),
      expiresAt,
      sources: [{ provider: "tikhub", platform: "douyin", sourceId: "aweme-1", sourceUrl: "https://example.com/aweme-1", publishedAt: now.toISOString() }],
    }];
    trip.socialWarnings = ["xiaohongshu: no key"];
    trip.planningMetadata = { source: "llm", llm: "used", social: "used" };

    const stored = await repository.createTrip(trip);
    const reloaded = await repository.getTrip(trip.id);

    expect(stored.trip.socialEvidence?.[0]).toMatchObject({ provider: "tikhub", expiresAt });
    expect(reloaded?.trip.socialPlatformStatus).toEqual({ douyin: "ok", xiaohongshu: "unavailable" });
    expect(reloaded?.trip.socialSignals?.[0].sources[0].provider).toBe("tikhub");
    expect(reloaded?.trip.planningMetadata).toEqual({ source: "llm", llm: "used", social: "used" });
  });
});
