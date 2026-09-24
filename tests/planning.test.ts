import { describe, expect, it } from "vitest";
import { createTripId, planWithRules } from "@/services/planning/rule-planner";
import { weatherForDate } from "@/services/weather/merge";
import type { Place } from "@/types/travel";

function place(id: string, category: Place["category"], lat: number): Place {
  return { id, name: id, category, lat, lng: 113 + lat / 100, rating: 4.5, reviewCount: 1, image: "", priceLevel: 1, address: "广州", openingStatus: "unknown", stayMinutes: 60, description: "", tags: [], district: "", source: "amap", sourceId: id, provenance: { source: "amap", estimated: false } };
}

describe("real-world rule planning", () => {
  const candidates = [
    place("gz-1", "attraction", 23.1), place("gz-2", "food", 23.11),
    place("gz-3", "attraction", 23.12), place("gz-4", "cafe", 23.13),
    place("gz-5", "attraction", 23.14), place("gz-6", "food", 23.15),
  ];

  it("plans any city using only server candidate IDs", () => {
    const plan = planWithRules({ destination: "广州", startDate: "2026-10-01", endDate: "2026-10-03", travelers: 2, budget: 3000, vibes: ["美食"], candidates });
    expect(plan.dayPlans).toHaveLength(3);
    expect(plan.dayPlans.every((day) => day.stops.length > 0)).toBe(true);
    const candidateIds = new Set(candidates.map((p) => p.id));
    expect(plan.dayPlans.flatMap((day) => day.stops).every((stop) => candidateIds.has(stop.placeId))).toBe(true);
  });

  it("creates collision-resistant UUID trip IDs", () => {
    const one = createTripId();
    const two = createTripId();
    expect(one).not.toBe(two);
    expect(one).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("matches weather by ISO date and never by array position", () => {
    const forecasts = [{ date: "2026-10-02", tempC: 31, condition: "晴", icon: "sun" as const }];
    expect(weatherForDate(forecasts, "2026-10-01").provenance.source).toBe("unavailable");
    expect(weatherForDate(forecasts, "2026-10-02").tempC).toBe(31);
  });
});
