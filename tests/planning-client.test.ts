import { describe, expect, it } from "vitest";
import {
  dateRangeWarning,
  draftDateSpan,
  generateBlockersFor,
  profilePatchFromDraft,
} from "@/features/new-trip/planning-client";
import { MAX_TRIP_DAYS } from "@/lib/trip-limits";

// +7 天起算，UTC/本地时区偏差不会把日期翻成过去
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

function draft(overrides: Partial<Parameters<typeof generateBlockersFor>[0]> = {}) {
  return {
    origin: "桂林",
    destination: "重庆",
    startDate: isoDate(7),
    endDate: isoDate(9),
    travelers: "2",
    budget: "2500",
    vibes: ["美食"],
    pace: "轻松留白",
    walkingTolerance: "少走路",
    transportPreference: "公共交通优先",
    mustVisit: "洪崖洞、长江索道",
    avoid: "爬山",
    includeOffers: true,
    includeSocialEvidence: true,
    ...overrides,
  };
}

describe("planning client cap alignment", () => {
  it("uses the same cap as the server", () => {
    // The drift regression: the client once allowed 31 days while the runtime
    // capped at 7, so users could build plans that failed at generate.
    const long = draft({ startDate: isoDate(7), endDate: isoDate(26) });
    expect(draftDateSpan(long)).toBe(20);
    expect(generateBlockersFor(long, undefined)).toContain("日期跨度");
    expect(dateRangeWarning(long)).toContain(`超过可生成的上限 ${MAX_TRIP_DAYS} 天`);

    const atCap = draft({ startDate: isoDate(7), endDate: isoDate(13) });
    expect(generateBlockersFor(atCap, undefined)).not.toContain("日期跨度");
    expect(dateRangeWarning(atCap)).toBe("");
  });

  it("blocks missing essentials and warns about a past departure without blocking", () => {
    const blockers = generateBlockersFor(draft({ destination: "  ", startDate: "", endDate: "" }));
    expect(blockers).toEqual(["目的地", "出发日期", "返程日期或旅行天数"]);

    // A stated day count can stand in for a return date.
    expect(generateBlockersFor(draft({ endDate: "" }), 3)).not.toContain("返程日期或旅行天数");

    const past = draft({ startDate: "2020-01-01", endDate: "2020-01-03" });
    expect(generateBlockersFor(past, undefined)).not.toContain("日期跨度");
    expect(dateRangeWarning(past)).toContain("已经过去");
  });

  it("maps the draft to a structured profile patch", () => {
    const patch = profilePatchFromDraft(draft());
    expect(patch).toMatchObject({
      origin: "桂林",
      destination: "重庆",
      startDate: isoDate(7),
      endDate: isoDate(9),
      travelers: 2,
      budget: 2500,
      pace: "relaxed",
      walkingTolerance: "low",
      transportPreference: "public",
      vibes: ["美食"],
      mustVisit: ["洪崖洞", "长江索道"],
      avoid: ["爬山"],
      includeExternalOffers: true,
      socialOptIn: true,
    });
  });

  it("omits empty draft fields instead of sending empty strings", () => {
    const patch = profilePatchFromDraft(draft({ origin: "", mustVisit: "", avoid: "", travelers: "" }));
    expect(patch).not.toHaveProperty("origin");
    expect(patch).not.toHaveProperty("mustVisit");
    expect(patch).not.toHaveProperty("avoid");
    expect(patch).not.toHaveProperty("travelers");
  });
});
