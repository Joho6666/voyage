// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractSocialSignals } from "@/services/social/signal-extractor";
import type { SocialObservation } from "@/services/social/types";

const now = new Date("2030-01-01T01:00:00.000Z");
function observation(input: Partial<SocialObservation> = {}): SocialObservation {
  return {
    provider: "redfox", platform: "xiaohongshu", sourceId: "note-1", city: "重庆", entityId: "hongyadong",
    content: "洪崖洞 19:00-21:00 排队很长，门票 ¥88，入口施工请绕行",
    publishedAt: "2030-01-01T00:00:00.000Z", fetchedAt: "2030-01-01T00:30:00.000Z",
    expiresAt: "2030-01-31T00:30:00.000Z", metrics: { views: 4000, likes: 200 }, rawMetadata: {},
    ...input,
  };
}

describe("social signal extraction", () => {
  it("extracts five types and counts deduplicated cross-platform evidence", () => {
    const first = observation();
    const second = observation({ provider: "tikhub", platform: "douyin", sourceId: "video-2", content: "洪崖洞 19:00-21:00 人很多，门票 ¥88", metrics: {} });
    const signals = extractSocialSignals([first, first, second], now);
    expect(signals.map((item) => item.signalType).sort()).toEqual([
      "crowd_risk", "popular_time", "price_signal", "travel_warning", "trend_score",
    ]);
    const crowd = signals.find((item) => item.signalType === "crowd_risk")!;
    expect(crowd).toMatchObject({ sampleSize: 2, platformCount: 2, confidence: 0.6 });
    expect(crowd.sources).toHaveLength(2);
    expect(signals.find((item) => item.signalType === "price_signal")?.value).toEqual({ amount: 88, currency: "CNY", reported: true });
    expect(signals.find((item) => item.signalType === "popular_time")?.expiresAt).toBe("2030-01-08T00:00:00.000Z");
    expect(signals.find((item) => item.signalType === "travel_warning")?.confidence).toBe(0.4);
  });

  it("rejects expired observations and signals", () => {
    const old = observation({ publishedAt: "2029-12-01T00:00:00.000Z" });
    expect(extractSocialSignals([old], now)).toEqual([]);
    expect(extractSocialSignals([observation({ expiresAt: "2029-12-31T00:00:00.000Z" })], now)).toEqual([]);
  });
});
