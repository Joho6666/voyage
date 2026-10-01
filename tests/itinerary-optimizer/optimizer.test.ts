import { describe, expect, it } from "vitest";
import type { Place } from "@/types/travel";
import { optimizeGuideDayAssignment } from "@/services/itinerary-optimizer";
import { haversineMeters } from "@/lib/utils";

/**
 * Acceptance-scenario POIs (real Chongqing coordinates, category + stay from
 * provider-shaped data). 磁器口 sits far west, 南山一棵树 far south-east —
 * sequential chunking would put them together; the optimizer must not.
 */
function place(id: string, name: string, category: Place["category"], lat: number, lng: number, stayMinutes = 60): Place {
  return {
    id, name, category, lat, lng, rating: 4.5, reviewCount: 0, image: "", priceLevel: 1,
    priceLabel: "免费", address: "重庆", openingStatus: "unknown", stayMinutes, description: "", tags: [],
    district: "", source: "amap", sourceId: id, provenance: { source: "amap", estimated: false },
  };
}

const GUIDE_PLACES: Place[] = [
  place("hongyadong", "洪崖洞", "attraction", 29.5624, 106.5773, 90),
  place("jiefangbei", "解放碑步行街", "attraction", 29.5568, 106.5770, 50),
  place("shibati", "十八梯", "attraction", 29.5530, 106.5720, 60),
  place("liziba", "李子坝观景平台", "attraction", 29.5577, 106.5354, 45),
  place("museum", "重庆中国三峡博物馆", "attraction", 29.5625, 106.5505, 90),
  place("guanyinqiao", "观音桥商圈", "shopping", 29.5756, 106.5308, 90),
  place("ciqikou", "磁器口古镇", "attraction", 29.5808, 106.4472, 120),
  place("nanshan", "南山一棵树观景台", "viewpoint", 29.5449, 106.6068, 60),
];

const THREE_DAYS = [
  { dayId: "d1", date: "2030-05-01" },
  { dayId: "d2", date: "2030-05-02" },
  { dayId: "d3", date: "2030-05-03" },
];

function dayOf(output: ReturnType<typeof optimizeGuideDayAssignment>, name: string) {
  const assignment = output.assignments.find((candidate) => candidate.places.some((candidatePlace) => candidatePlace.name === name));
  return assignment?.dayId;
}

describe("itinerary optimizer v1", () => {
  it("clusters geographically: 磁器口 (west) never shares a day with 南山 (south-east)", () => {
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    expect(dayOf(output, "磁器口古镇")).not.toBe(dayOf(output, "南山一棵树观景台"));
  });

  it("keeps same-day chains tight (no cross-city zigzag)", () => {
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    for (const assignment of output.assignments) {
      const meters = output.metrics.estimatedWalkingMetersByDay[assignment.dayId] ?? 0;
      // A same-day chain of nearby stops stays well under the ~8km
      // straight-line span a zigzag across districts would produce.
      expect(meters).toBeLessThan(8000);
    }
    // The central neighbors stay together: 洪崖洞/解放碑/十八梯 sit within
    // ~600 m of each other, so at least two of them share a day.
    const central = output.assignments.find((assignment) => assignment.places.some((candidate) => candidate.name === "洪崖洞"));
    expect(central).toBeTruthy();
    const centralNames = central!.places.map((candidate) => candidate.name);
    const centralNeighbors = centralNames.filter((name) => ["解放碑步行街", "十八梯"].includes(name));
    expect(centralNeighbors.length).toBeGreaterThanOrEqual(1);
  });

  it("beats sequential chunking on total walking for low walking tolerance", () => {
    const optimized = optimizeGuideDayAssignment({
      places: GUIDE_PLACES, days: THREE_DAYS,
      profile: { pace: "balanced", walkingTolerance: "low" } as never,
    });
    // The old algorithm: ceil(N/days) sequential chunks in guide order.
    const perDay = Math.ceil(GUIDE_PLACES.length / THREE_DAYS.length);
    const baselineAssignments = THREE_DAYS.map((day) => ({ dayId: day.dayId, places: [] as Place[] }));
    GUIDE_PLACES.forEach((candidate, index) => {
      baselineAssignments[Math.min(Math.floor(index / perDay), baselineAssignments.length - 1)].places.push(candidate);
    });
    const baselineWalking = baselineAssignments.reduce((sum, assignment) => {
      let walk = 0;
      for (let index = 1; index < assignment.places.length; index += 1) {
        walk += haversineMeters(assignment.places[index - 1], assignment.places[index]);
      }
      return sum + walk;
    }, 0);
    expect(optimized.metrics.totalEstimatedWalkingMeters).toBeLessThan(baselineWalking);
  });

  it("relaxed pace lowers daily density", () => {
    const output = optimizeGuideDayAssignment({
      places: GUIDE_PLACES, days: THREE_DAYS,
      profile: { pace: "relaxed" } as never,
    });
    for (const assignment of output.assignments) {
      expect(assignment.places.length).toBeLessThanOrEqual(3);
    }
  });

  it("keeps mustVisit places and excludes avoid places", () => {
    const output = optimizeGuideDayAssignment({
      places: [...GUIDE_PLACES, place("dazu", "大足石刻", "attraction", 29.7480, 105.7050, 240)],
      days: THREE_DAYS,
      profile: { mustVisit: ["洪崖洞"], avoid: ["大足"] } as never,
    });
    expect(dayOf(output, "洪崖洞")).toBeTruthy();
    expect(dayOf(output, "大足石刻")).toBeUndefined();
    expect(output.warnings.some((warning) => warning.includes("大足石刻"))).toBe(true);
  });

  it("on a rainy day the chain starts with an indoor place", () => {
    // 洪崖洞 + 博物馆 cluster centrally, 磁器口 west → rain on day 1 keeps
    // the indoor museum first in the chain.
    const output = optimizeGuideDayAssignment({
      places: [GUIDE_PLACES[0], GUIDE_PLACES[4], GUIDE_PLACES[6]],
      days: [
        { dayId: "d1", weather: { condition: "中雨", icon: "rain" } },
        { dayId: "d2" },
      ],
    });
    const day1 = output.assignments.find((assignment) => assignment.dayId === "d1");
    expect(day1?.places[0].name).toBe("重庆中国三峡博物馆");
  });

  it("puts night-view viewpoints last in their day", () => {
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    const assignment = output.assignments.find((candidate) => candidate.places.some((candidatePlace) => candidatePlace.name === "南山一棵树观景台"));
    expect(assignment).toBeTruthy();
    expect(assignment!.places.at(-1)?.name).toBe("南山一棵树观景台");
    const decision = output.decisions.find((candidate) => candidate.reason.includes("南山一棵树"));
    expect(decision?.kind).toBe("time_window");
  });

  it("reports unknown opening hours as unresolved instead of inventing them", () => {
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    expect(output.unresolvedConstraints.join("\n")).toContain("营业时间为 unknown");
    for (const assignment of output.assignments) {
      for (const candidate of assignment.places) {
        expect(candidate.openingHours ?? undefined).toBeUndefined();
      }
    }
  });

  it("reports unknown weather instead of pretending", () => {
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    expect(output.unresolvedConstraints.join("\n")).toContain("天气未知");
  });

  it("runs without any provider (pure function over candidate places)", () => {
    // No provider, no network, no clock: the call itself is the proof; the
    // output must still be complete.
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES.slice(0, 2), days: [{ dayId: "d1" }] });
    expect(output.assignments).toHaveLength(1);
    expect(output.assignments[0].places).toHaveLength(2);
  });

  it("is deterministic: identical input yields identical output", () => {
    const first = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    const second = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("explains its decisions with real data, not boilerplate", () => {
    const output = optimizeGuideDayAssignment({ places: GUIDE_PLACES, days: THREE_DAYS });
    expect(output.decisions.length).toBeGreaterThan(0);
    for (const decision of output.decisions) {
      expect(decision.reason.length).toBeGreaterThan(8);
      expect(decision.reason).not.toMatch(/^已优化/);
    }
  });
});
