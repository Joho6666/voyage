import { describe, expect, it } from "vitest";
import {
  dateRangeWarning,
  draftDateSpan,
  generateBlockersFor,
  profilePatchFromDraft,
} from "@/features/new-trip/planning-client";
import { MAX_TRIP_DAYS } from "@/lib/trip-limits";

/** Local-date string N days from now. Hardcoded dates turned this suite into
 * a time bomb: 2026-10-01 silently became yesterday and the "no warning"
 * assertions started failing on a calendar change, not a code change. */
function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function draft(overrides: Partial<Parameters<typeof generateBlockersFor>[0]> = {}) {
  return {
    origin: "桂林",
    destination: "重庆",
    startDate: isoInDays(0),
    endDate: isoInDays(2),
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
    const long = draft({ startDate: isoInDays(0), endDate: isoInDays(19) });
    expect(draftDateSpan(long)).toBe(20);
    expect(generateBlockersFor(long, undefined)).toContain("日期跨度");
    expect(dateRangeWarning(long)).toContain(`超过可生成的上限 ${MAX_TRIP_DAYS} 天`);

    const atCap = draft({ startDate: isoInDays(0), endDate: isoInDays(6) });
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
      startDate: isoInDays(0),
      endDate: isoInDays(2),
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
