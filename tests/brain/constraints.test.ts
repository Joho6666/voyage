// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Place } from "@/types/travel";
import { evaluateOutline, outlineSpendFloor, placeMatchesTerm, repairOutline } from "@/services/brain/constraints";
import type { Outline } from "@/services/planning/outline-planner";
import type { PlanningProfile } from "@/schemas/planning";

function place(id: string, name: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    name,
    category: "attraction",
    lat: 29.56,
    lng: 106.55,
    rating: 4.5,
    reviewCount: 100,
    image: "",
    priceLevel: 2,
    address: `${name}路1号`,
    openingStatus: "unknown",
    stayMinutes: 90,
    description: name,
    tags: [],
    district: "渝中区",
    source: "amap",
    sourceId: id,
    provenance: { source: "amap", estimated: false },
    ...overrides,
  };
}

const HONGYA = place("p-hongya", "洪崖洞民俗风貌区", { tags: ["夜景"], estimatedCost: 0 });
const CIQIKOU = place("p-ciqikou", "磁器口古镇", { district: "沙坪坝区", lat: 29.578, lng: 106.45, estimatedCost: 50 });
const MUSEUM = place("p-museum", "三峡博物馆", { openingHours: "09:00-17:00", estimatedCost: 0, stayMinutes: 120 });
const EXPENSIVE = place("p-expensive", "奢华观景台", { estimatedCost: 300, district: "南岸区", lat: 29.55, lng: 106.6 });
const PARK = place("p-park", "南山植物园", { district: "南岸区", lat: 29.54, lng: 106.58, estimatedCost: 30 });

const CANDIDATES = [HONGYA, CIQIKOU, MUSEUM, EXPENSIVE, PARK];

function outlineOf(...days: Array<Array<{ placeId: string; startTime?: string; durationMinutes?: number; meal?: "lunch" | "dinner" }>>): Outline {
  return {
    title: "测试行程",
    dayPlans: days.map((stops, index) => ({
      title: `Day ${index + 1}`,
      summary: "",
      stops: stops.map((stop, order) => ({
        placeId: stop.placeId,
        startTime: stop.startTime ?? "09:00",
        durationMinutes: stop.durationMinutes ?? 90,
        ...(stop.meal ? { meal: stop.meal } : {}),
        order,
      })),
    })),
    tasks: [],
  };
}

const BASE_CTX = {
  candidates: CANDIDATES,
  expectedDays: 2,
  budget: 2500,
  travelers: 2,
};

describe("placeMatchesTerm", () => {
  it("matches name, tags, district and description case-insensitively", () => {
    expect(placeMatchesTerm(HONGYA, "洪崖洞")).toBe(true);
    expect(placeMatchesTerm(HONGYA, "夜景")).toBe(true);
    expect(placeMatchesTerm(CIQIKOU, "沙坪坝")).toBe(true);
    expect(placeMatchesTerm(HONGYA, "disney")).toBe(false);
  });
});

describe("evaluateOutline hard constraints", () => {
  it("passes a compliant outline with zero hard violations", () => {
    const outline = outlineOf(
      [
        { placeId: "p-hongya", meal: "lunch" },
        { placeId: "p-museum" },
      ],
      [
        { placeId: "p-ciqikou", meal: "dinner" },
        { placeId: "p-park" },
      ],
    );
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, profile: { mustVisit: ["洪崖洞"], avoid: [], vibes: [] } as PlanningProfile });
    expect(evaluation.hardViolations).toHaveLength(0);
    expect(evaluation.score).toBeGreaterThanOrEqual(90);
  });

  it("flags a missing must-visit and offers an insert hint", () => {
    const outline = outlineOf([{ placeId: "p-museum" }], [{ placeId: "p-park" }]);
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, profile: { mustVisit: ["洪崖洞"], avoid: [], vibes: [] } as PlanningProfile });
    const violation = evaluation.hardViolations.find((candidate) => candidate.constraintId.startsWith("mustVisit"));
    expect(violation?.severity).toBe("error");
    expect(evaluation.repairHints.some((hint) => hint.kind === "insertPlace" && hint.target === "洪崖洞")).toBe(true);
  });

  it("flags a must-visit with no candidate match as a warning, not a repairable error", () => {
    const outline = outlineOf([{ placeId: "p-museum" }], [{ placeId: "p-park" }]);
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, profile: { mustVisit: ["外星人遗迹"], avoid: [], vibes: [] } as PlanningProfile });
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId.startsWith("mustVisit"))).toBe(false);
    expect(evaluation.warnings.some((warning) => warning.includes("外星人遗迹"))).toBe(true);
  });

  it("flags avoid matches with a replace hint", () => {
    const outline = outlineOf([{ placeId: "p-ciqikou" }], [{ placeId: "p-park" }]);
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, profile: { mustVisit: [], avoid: ["磁器口"], vibes: [] } as PlanningProfile });
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId.startsWith("avoid:"))).toBe(true);
    expect(evaluation.repairHints.some((hint) => hint.kind === "replacePlace" && hint.target === "p-ciqikou")).toBe(true);
  });

  it("flags a day-count mismatch with a padDays hint", () => {
    const outline = outlineOf([{ placeId: "p-hongya" }]);
    const evaluation = evaluateOutline(outline, BASE_CTX);
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId === "dates")).toBe(true);
    expect(evaluation.repairHints.some((hint) => hint.kind === "padDays")).toBe(true);
  });

  it("flags arrival outside known opening hours but treats unknown hours as uncertainty", () => {
    const outline = outlineOf([{ placeId: "p-museum", startTime: "20:00" }], [{ placeId: "p-hongya" }]);
    const evaluation = evaluateOutline(outline, BASE_CTX);
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId.startsWith("openingHours"))).toBe(true);
    expect(evaluation.warnings.some((warning) => warning.includes("营业时间未知"))).toBe(true);
  });

  it("flags a certain budget overrun from the spend floor", () => {
    // 4 stops × ¥300 × 2 travelers = ¥2400 floor; a ¥1000 budget must fail.
    const outline = outlineOf(
      [{ placeId: "p-expensive" }, { placeId: "p-expensive" }],
      [{ placeId: "p-expensive" }, { placeId: "p-expensive" }],
    );
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, budget: 1000 });
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId === "budgetCeiling")).toBe(true);
    expect(evaluation.repairHints.some((hint) => hint.kind === "dropStop")).toBe(true);
  });

  it("flags an intra-city leg over 40km as unreachable", () => {
    const remote = place("p-remote", "远郊雪山", { lat: 30.4, lng: 107.2, district: "远郊" });
    const outline = outlineOf([{ placeId: "p-hongya" }, { placeId: "p-remote" }], [{ placeId: "p-museum" }]);
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, candidates: [...CANDIDATES, remote] });
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId === "reachability")).toBe(true);
    expect(evaluation.repairHints.some((hint) => hint.kind === "reorder")).toBe(true);
  });
});

describe("evaluateOutline soft penalties", () => {
  it("penalises over-pace days, backtracking and missing meals", () => {
    const outline = outlineOf(
      [
        { placeId: "p-hongya" },
        { placeId: "p-ciqikou" },
        { placeId: "p-museum" },
        { placeId: "p-park" },
        { placeId: "p-expensive" },
      ],
      [{ placeId: "p-hongya" }],
    );
    const evaluation = evaluateOutline(outline, {
      ...BASE_CTX,
      profile: { pace: "relaxed", walkingTolerance: "low", vibes: [] } as PlanningProfile,
    });
    expect(evaluation.softPenalties.some((penalty) => penalty.constraintId.startsWith("pace:"))).toBe(true);
    expect(evaluation.softPenalties.some((penalty) => penalty.constraintId.startsWith("backtracking:"))).toBe(true);
    expect(evaluation.softPenalties.some((penalty) => penalty.constraintId.startsWith("meal:"))).toBe(true);
    expect(evaluation.score).toBeLessThan(100);
  });
});

describe("repairOutline", () => {
  it("inserts a missing must-visit into the geographically closest day", () => {
    const outline = outlineOf([{ placeId: "p-hongya" }], [{ placeId: "p-park" }]);
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, profile: { mustVisit: ["三峡博物馆"], avoid: [], vibes: [] } as PlanningProfile });
    const repaired = repairOutline(outline, evaluation, BASE_CTX);
    expect(repaired.applied.some((fix) => fix.includes("三峡博物馆"))).toBe(true);
    const allStops = repaired.outline.dayPlans.flatMap((day) => day.stops.map((stop) => stop.placeId));
    expect(allStops).toContain("p-museum");
  });

  it("replaces avoided stops with a same-category candidate and removes duplicates", () => {
    const outline = outlineOf([{ placeId: "p-ciqikou", meal: "lunch" }], [{ placeId: "p-park" }]);
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, profile: { mustVisit: [], avoid: ["磁器口"], vibes: [] } as PlanningProfile });
    const repaired = repairOutline(outline, evaluation, BASE_CTX);
    const ids = repaired.outline.dayPlans.flatMap((day) => day.stops.map((stop) => stop.placeId));
    expect(ids).not.toContain("p-ciqikou");
    expect(repaired.applied.some((fix) => fix.includes("替换") || fix.includes("移除"))).toBe(true);
  });

  it("pads and truncates day plans to the expected day count", () => {
    // Three planned days for a two-day trip: the tail is truncated.
    const long = outlineOf(
      [{ placeId: "p-hongya" }, { placeId: "p-museum" }],
      [{ placeId: "p-park" }],
      [{ placeId: "p-ciqikou" }],
    );
    const truncated = repairOutline(long, evaluateOutline(long, { ...BASE_CTX, expectedDays: 2 }), { ...BASE_CTX, expectedDays: 2 });
    expect(truncated.outline.dayPlans).toHaveLength(2);
    expect(truncated.applied.some((fix) => fix.includes("裁剪"))).toBe(true);

    // One planned day for a three-day trip: empty days are padded.
    const short = outlineOf([{ placeId: "p-hongya" }]);
    const padded = repairOutline(short, evaluateOutline(short, { ...BASE_CTX, expectedDays: 3 }), { ...BASE_CTX, expectedDays: 3 });
    expect(padded.outline.dayPlans).toHaveLength(3);
    expect(padded.applied.some((fix) => fix.includes("补齐"))).toBe(true);
  });

  it("shifts arrival times to the latest start that still fits the opening window", () => {
    // Museum opens 09:00-17:00 with a 120min stay: a 20:00 arrival is repaired
    // to 15:00, the latest start whose visit still ends by closing time.
    const outline = outlineOf([{ placeId: "p-museum", startTime: "20:00" }], [{ placeId: "p-hongya" }]);
    const evaluation = evaluateOutline(outline, BASE_CTX);
    const repaired = repairOutline(outline, evaluation, BASE_CTX);
    const stop = repaired.outline.dayPlans[0].stops.find((candidate) => candidate.placeId === "p-museum");
    expect(stop?.startTime).toBe("15:00");
  });

  it("drops the most expensive non-must stops until the floor fits the budget", () => {
    const outline = outlineOf(
      [{ placeId: "p-expensive" }, { placeId: "p-expensive" }],
      [{ placeId: "p-expensive" }, { placeId: "p-hongya", meal: "lunch" }],
    );
    const evaluation = evaluateOutline(outline, { ...BASE_CTX, budget: 900 });
    const repaired = repairOutline(outline, evaluation, { ...BASE_CTX, budget: 900 });
    const floor = outlineSpendFloor(repaired.outline, { ...BASE_CTX, budget: 900 });
    expect(floor.total).toBeLessThanOrEqual(900);
    expect(repaired.applied.some((fix) => fix.includes("奢华观景台"))).toBe(true);
    // The must-visit and the meal survive the budget repair.
    const ids = repaired.outline.dayPlans.flatMap((day) => day.stops.map((stop) => stop.placeId));
    expect(ids).toContain("p-hongya");
  });

  it("reorders a day greedily when a leg is unreachable", () => {
    const remote = place("p-remote", "远郊雪山", { lat: 30.4, lng: 107.2, district: "远郊" });
    const outline = outlineOf([{ placeId: "p-hongya" }, { placeId: "p-remote" }, { placeId: "p-museum" }], [{ placeId: "p-park" }]);
    const ctx = { ...BASE_CTX, candidates: [...CANDIDATES, remote] };
    const evaluation = evaluateOutline(outline, ctx);
    expect(evaluation.hardViolations.some((candidate) => candidate.constraintId === "reachability")).toBe(true);
    const repaired = repairOutline(outline, evaluation, ctx);
    expect(repaired.applied.some((fix) => fix.includes("重排"))).toBe(true);
    const day0 = repaired.outline.dayPlans[0].stops.map((stop) => stop.placeId);
    expect(day0[0]).toBe("p-hongya");
    // Greedy nearest-neighbour pulls the museum (same block) next to 洪崖洞
    // and pushes the remote mountain to the end of the day.
    expect(day0.indexOf("p-museum")).toBeLessThan(day0.indexOf("p-remote"));
    // A truly remote place cannot be fixed by reordering alone: the violation
    // must stay visible instead of being silently resolved.
    const reEvaluated = evaluateOutline(repaired.outline, ctx);
    expect(reEvaluated.hardViolations.some((candidate) => candidate.constraintId === "reachability")).toBe(true);
  });

  it("is idempotent: repairing an already-repaired outline applies nothing new", () => {
    const outline = outlineOf([{ placeId: "p-museum", startTime: "20:00" }], [{ placeId: "p-hongya" }]);
    const evaluation = evaluateOutline(outline, BASE_CTX);
    const first = repairOutline(outline, evaluation, BASE_CTX);
    const secondEvaluation = evaluateOutline(first.outline, BASE_CTX);
    const second = repairOutline(first.outline, secondEvaluation, BASE_CTX);
    expect(second.applied).toHaveLength(0);
  });
});
