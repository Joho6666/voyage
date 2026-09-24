import { describe, expect, it } from "vitest";
import { rankTransportOptions } from "@/services/transport/scoring";
import { retrieveTravelKnowledge } from "@/services/knowledge/retriever";
import type { TransportOption } from "@/types/transport-intelligence";

function option(input: Partial<TransportOption> & Pick<TransportOption, "id" | "mode">): TransportOption {
  return {
    requestedMode: input.mode,
    durationMinutes: 30,
    distanceMeters: 3000,
    walkMeters: 500,
    transferCount: 0,
    cost: { min: 0, max: 0, currency: "CNY", estimated: true },
    trafficLevel: "unknown",
    crowdLevel: "unknown",
    rainExposure: 0.2,
    confidence: 0.9,
    source: "amap",
    estimated: false,
    updatedAt: "2030-01-01T00:00:00.000Z",
    ...input,
  };
}

describe("transport intelligence", () => {
  it("prefers low-walking transport when the traveler is tired and it is raining", () => {
    const ranked = rankTransportOptions([
      option({
        id: "walk",
        mode: "walk",
        durationMinutes: 26,
        walkMeters: 2100,
        distanceMeters: 2100,
        rainExposure: 1,
        cost: { min: 0, max: 0, currency: "CNY", estimated: false },
      }),
      option({
        id: "metro",
        mode: "metro",
        durationMinutes: 24,
        walkMeters: 520,
        transferCount: 1,
        cost: { min: 3, max: 3, currency: "CNY", estimated: true },
        rainExposure: 0.22,
      }),
      option({
        id: "taxi",
        mode: "taxi",
        durationMinutes: 17,
        walkMeters: 80,
        cost: { min: 24, max: 32, currency: "CNY", estimated: true },
        rainExposure: 0.1,
      }),
    ], {
      walkingTolerance: "low",
      fatigue: "high",
      weather: "rain",
      budgetSensitivity: "medium",
      travelers: 2,
    });

    expect(ranked[0].mode).toBe("taxi");
    expect(ranked[0].score).toBeGreaterThan(ranked.find((item) => item.mode === "walk")!.score);
    expect(ranked[0].reasons).toContain("更适合疲劳状态");
  });

  it("retrieves city-specific and global transport knowledge", () => {
    const matches = retrieveTravelKnowledge({
      city: "重庆",
      query: "洪崖洞 夜景 人流 步行",
      tags: ["walking"],
      limit: 5,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((item) => item.city === "重庆")).toBe(true);
    expect(matches.some((item) => item.title.includes("洪崖洞") || item.title.includes("山城"))).toBe(true);
    expect(matches.every((item) => item.confidence > 0)).toBe(true);
  });
});
