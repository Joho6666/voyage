// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  alignPlanningDays,
  effectiveTripDays,
  mergePlanningProfiles,
  planningProfileToPrompt,
} from "@/services/planning/profile";

describe("planning profile day-count consistency", () => {
  it("lets the date span win over a day count gathered earlier", () => {
    const profile = mergePlanningProfiles(
      { destination: "南京", days: 3 },
      { startDate: "2026-09-28", endDate: "2026-10-01" },
    );
    expect(profile.days).toBe(4);
    expect(effectiveTripDays(profile)).toBe(4);
  });

  it("moves the return date when the traveller changes the day count", () => {
    const profile = mergePlanningProfiles(
      { destination: "南京", startDate: "2026-09-28", endDate: "2026-09-30" },
      { days: 5 },
    );
    expect(profile.endDate).toBe("2026-10-02");
    expect(profile.days).toBe(5);
    expect(effectiveTripDays(profile)).toBe(5);
  });

  it("preserves the trip length when only the departure date moves", () => {
    const profile = mergePlanningProfiles(
      { destination: "南京", startDate: "2026-09-28", days: 4 },
      { startDate: "2026-10-05" },
    );
    expect(profile.endDate).toBe("2026-10-08");
    expect(profile.days).toBe(4);
  });

  it("clears a stale return date that would precede a new departure", () => {
    const profile = mergePlanningProfiles(
      { destination: "南京", startDate: "2026-09-01", endDate: "2026-09-03" },
      { startDate: "2026-12-01" },
    );
    // Nothing else tells us how long the trip is, and a return date before the
    // new departure would make the profile invalid, so it is cleared for the
    // traveller to re-pick rather than silently kept.
    expect(profile.startDate).toBe("2026-12-01");
    expect(profile.endDate).toBeUndefined();
  });

  it("keeps a day count when no departure date exists yet", () => {
    const profile = mergePlanningProfiles({ destination: "南京" }, { days: 3 });
    expect(profile.days).toBe(3);
    expect(profile.endDate).toBeUndefined();
    expect(profile.startDate).toBeUndefined();
  });

  it("normalises a stored profile whose day count contradicts its span", () => {
    const aligned = alignPlanningDays({
      destination: "南京",
      startDate: "2026-09-28",
      endDate: "2026-10-01",
      days: 3,
      vibes: [],
      mustVisit: [],
      avoid: [],
      dietary: [],
      socialOptIn: false,
      includeExternalOffers: false,
    });
    expect(aligned.days).toBe(4);
  });

  it("states the trip length once, from the date pair when it exists", () => {
    const withDates = planningProfileToPrompt(mergePlanningProfiles(
      { destination: "南京", days: 3 },
      { startDate: "2026-09-28", endDate: "2026-10-01" },
    ));
    expect(withDates).toContain("出发日期：2026-09-28");
    expect(withDates).toContain("结束日期：2026-10-01");
    expect(withDates).not.toContain("天数：");

    const withoutDates = planningProfileToPrompt(mergePlanningProfiles({ destination: "南京" }, { days: 3 }));
    expect(withoutDates).toContain("天数：3");
  });

  it("agrees with the outline planner on the number it verifies", () => {
    const profile = mergePlanningProfiles(
      { destination: "南京", days: 3 },
      { startDate: "2026-09-28", endDate: "2026-10-01" },
    );
    // The planner derives its own expected count from the same date pair.
    const days = effectiveTripDays(profile);
    expect(days).toBe(4);
    const span = Math.floor(
      (Date.parse("2026-10-01T12:00:00Z") - Date.parse("2026-09-28T12:00:00Z")) / 86_400_000,
    ) + 1;
    expect(days).toBe(span);
  });
});
