import { describe, expect, it } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import { dayStats, recomputeDay } from "@/services/routing";

describe("routing", () => {
  it("assigns endTime after each stop", () => {
    const next = recomputeDay(chongqingTrip, "day-1");
    const items = next.items.filter((i) => i.dayId === "day-1").sort((a, b) => a.order - b.order);
    expect(items[0]?.endTime).toMatch(/^\d{2}:\d{2}$/);
    expect(items.length).toBeGreaterThan(2);
  });

  it("computes place count and distance for a day", () => {
    const stats = dayStats(chongqingTrip, "day-1");
    expect(stats.places).toBeGreaterThan(0);
    expect(stats.meters).toBeGreaterThan(0);
  });
});
