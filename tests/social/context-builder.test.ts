// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SocialContextBuilder, buildSocialContext } from "@/services/social/context-builder";
import { extractSocialSignals } from "@/services/social/signal-extractor";
import type { SocialObservation } from "@/services/social/types";

const now = new Date("2030-01-01T01:00:00.000Z");
const observation: SocialObservation = {
  provider: "redfox", platform: "xiaohongshu", sourceId: "note-1", sourceUrl: "https://example.com/note-1",
  city: "重庆", entityId: "hongyadong", content: "洪崖洞 19:00-21:00 人很多，入口施工请绕行",
  publishedAt: "2030-01-01T00:00:00.000Z", fetchedAt: "2030-01-01T00:30:00.000Z",
  expiresAt: "2030-01-31T00:30:00.000Z", metrics: {}, rawMetadata: {},
};

describe("social context builder", () => {
  it("builds an entity context from extracted evidence without changing live facts", async () => {
    const signals = extractSocialSignals([observation], now);
    const builder = new SocialContextBuilder(async () => signals);
    const context = await builder.build({ city: "重庆", poi: "hongyadong", query: "晚上排队", time: "20:00" }, now);
    expect(context.crowdRisk).toBe("high");
    expect(context.popularTimes).toEqual([{ start: "19:00", end: "21:00", confidence: 0.4 }]);
    expect(context.warnings).toContain(observation.content);
    expect(context.sources).toHaveLength(1);
    expect(context.confidence).toBeGreaterThan(0);
  });

  it("filters expired and unrelated signals and degrades when storage is unavailable", async () => {
    const signals = extractSocialSignals([observation], now);
    const unrelated = { ...signals[0], id: "other", city: "桂林" };
    const expired = { ...signals[0], id: "expired", expiresAt: "2029-12-31T00:00:00.000Z" };
    const context = buildSocialContext({ city: "重庆", poi: "hongyadong" }, [...signals, unrelated, expired], now);
    expect(context.signals).toHaveLength(signals.length);
    const unavailable = await new SocialContextBuilder(async () => { throw new Error("database offline"); })
      .build({ city: "重庆" }, now);
    expect(unavailable).toMatchObject({ crowdRisk: "unknown", confidence: 0, signals: [] });
  });
});
