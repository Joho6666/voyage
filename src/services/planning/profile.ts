import type { Place } from "@/types/travel";
import {
  planningProfilePatchSchema,
  planningProfileSchema,
  type PlanningField,
  type PlanningProfile,
  type PlanningProfilePatch,
} from "@/schemas/planning";

const DAY_MS = 86_400_000;

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function uniqueStrings(values: readonly string[] | undefined, max: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (!value) continue;
    const key = normalizeText(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00Z`).getTime();
  const end = new Date(`${endDate}T12:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.floor((end - start) / DAY_MS) + 1;
}

export function canonicalPlanningProfile(input: unknown): PlanningProfile {
  const parsed = planningProfileSchema.parse(input ?? {});
  const { includeSocialEvidence, accessibilityNeeds, ...rest } = parsed;
  const accessibility = rest.accessibility ?? accessibilityNeeds;
  return planningProfileSchema.parse({
    ...rest,
    ...(accessibility === undefined ? {} : { accessibility }),
    socialOptIn: rest.socialOptIn || includeSocialEvidence === true,
  });
}

function canonicalPatch(input: unknown): PlanningProfilePatch {
  const parsed = planningProfilePatchSchema.parse(input ?? {});
  const { includeSocialEvidence, accessibilityNeeds, ...rest } = parsed;
  const accessibility = rest.accessibility ?? accessibilityNeeds;
  return {
    ...rest,
    ...(accessibility === undefined ? {} : { accessibility }),
    ...(rest.socialOptIn === undefined && includeSocialEvidence !== undefined
      ? { socialOptIn: includeSocialEvidence }
      : {}),
  };
}

/** Merge only explicit profile facts; no missing value is guessed. */
export function mergePlanningProfiles(
  base?: Partial<PlanningProfile> | PlanningProfilePatch,
  patch?: Partial<PlanningProfile> | PlanningProfilePatch,
): PlanningProfile {
  const left = canonicalPlanningProfile(base ?? {});
  const right = canonicalPatch(patch ?? {});
  const scalarKeys = [
    "destination",
    "origin",
    "startDate",
    "endDate",
    "days",
    "travelers",
    "budget",
    "pace",
    "walkingTolerance",
    "transportPreference",
    "children",
    "elderly",
    "budgetMode",
    "includeExternalOffers",
  ] as const;
  const merged: Record<string, unknown> = { ...left };
  for (const key of scalarKeys) {
    const value = right[key];
    if (value !== undefined) merged[key] = value;
  }
  merged.vibes = uniqueStrings([...left.vibes, ...(right.vibes ?? [])], 12);
  merged.mustVisit = uniqueStrings([...left.mustVisit, ...(right.mustVisit ?? [])], 20);
  merged.avoid = uniqueStrings([...left.avoid, ...(right.avoid ?? [])], 20);
  merged.dietary = uniqueStrings([...left.dietary, ...(right.dietary ?? [])], 8);
  if (right.accessibility !== undefined) merged.accessibility = right.accessibility;
  if (right.socialOptIn !== undefined) merged.socialOptIn = right.socialOptIn;

  // Reconcile before validating: the schema rejects a return date that precedes
  // departure, and a stale one must be cleared rather than fail the whole merge.
  const reconciled = reconcileDays({
    ...(typeof merged.startDate === "string" ? { startDate: merged.startDate } : {}),
    ...(typeof merged.endDate === "string" ? { endDate: merged.endDate } : {}),
    ...(typeof merged.days === "number" ? { days: merged.days } : {}),
  }, right);
  const normalized = planningProfileSchema.parse({ ...merged, ...reconciled });
  return alignPlanningDays(normalized);
}

function shiftDate(date: string, offsetDays: number) {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

interface DayFacts {
  startDate?: string;
  endDate?: string;
  days?: number;
}

/**
 * Whichever of "days" and the date pair the user just changed wins, so editing
 * one field never silently contradicts the other.
 *
 * - they stated a day count -> the return date moves to match
 * - they picked a return date -> the day count follows the span (in align)
 * - they moved only the departure date -> the trip length is preserved
 */
function reconcileDays(profile: DayFacts, patch: PlanningProfilePatch): DayFacts {
  const statedDays = patch.days !== undefined && patch.endDate === undefined;
  const statedDates = patch.startDate !== undefined || patch.endDate !== undefined;

  if (statedDays && profile.startDate) {
    const days = patch.days!;
    return { ...profile, days, endDate: shiftDate(profile.startDate, days - 1) };
  }
  if (statedDays) {
    // A day count with no departure date yet: keep it, and let the span be
    // derived once a real date exists.
    return { ...profile, endDate: undefined };
  }
  if (statedDates && patch.endDate === undefined && profile.startDate) {
    if (profile.days) return { ...profile, endDate: shiftDate(profile.startDate, profile.days - 1) };
    // No length to preserve; a return date before the new departure would make
    // the profile invalid, so it is cleared for the traveller to re-pick.
    if (profile.endDate && profile.endDate < profile.startDate) {
      return { ...profile, endDate: undefined };
    }
  }
  return profile;
}

/**
 * Final normalisation for profiles that arrive without patch context (loaded
 * from storage, or built by hand): the date span is the more specific fact, so
 * a day count that disagrees with it is corrected rather than trusted.
 */
export function alignPlanningDays(profile: PlanningProfile): PlanningProfile {
  const { startDate, endDate, days } = profile;
  if (startDate && endDate) {
    const span = daysBetween(startDate, endDate);
    if (span && span !== days) return { ...profile, days: span };
    return profile;
  }
  // Only one date plus an explicit day count: the missing date is arithmetic,
  // never a guess about when the traveller leaves.
  if (startDate && !endDate && days) {
    return { ...profile, endDate: shiftDate(startDate, days - 1) };
  }
  if (!startDate && endDate && days) {
    return { ...profile, startDate: shiftDate(endDate, -(days - 1)) };
  }
  return profile;
}

/**
 * The day count the planner will actually verify against, derived from the same
 * input the trip compiler uses.  Callers must not carry a second, competing
 * number into the prompt.
 */
export function effectiveTripDays(profile: PlanningProfile) {
  const span = profile.startDate && profile.endDate
    ? daysBetween(profile.startDate, profile.endDate)
    : undefined;
  return span ?? profile.days;
}

export function missingPlanningFields(profile: PlanningProfile): PlanningField[] {
  const missing: PlanningField[] = [];
  if (!profile.destination) missing.push("destination");
  if (!profile.startDate || !(profile.endDate || profile.days)) missing.push("dates");
  if (!profile.travelers) missing.push("travelers");
  if (profile.budget === undefined) missing.push("budget");
  return missing;
}

export function planningProfileToPrompt(profile: PlanningProfile) {
  const lines = [
    profile.destination ? `目的地：${profile.destination}` : "",
    profile.origin ? `出发地：${profile.origin}` : "",
    profile.startDate ? `出发日期：${profile.startDate}` : "",
    profile.endDate ? `结束日期：${profile.endDate}` : "",
    // The date pair already states the length; repeating a day count here put a
    // second, competing number in front of the model.
    !profile.endDate && profile.days ? `天数：${profile.days}` : "",
    profile.travelers ? `人数：${profile.travelers}` : "",
    profile.budget !== undefined ? `总预算：¥${profile.budget}` : "",
    profile.pace ? `节奏：${profile.pace}` : "",
    profile.walkingTolerance ? `步行接受度：${profile.walkingTolerance}` : "",
    profile.transportPreference ? `交通偏好：${profile.transportPreference}` : "",
    profile.vibes.length ? `氛围偏好：${profile.vibes.join("、")}` : "",
    profile.mustVisit.length ? `必去：${profile.mustVisit.join("、")}` : "",
    profile.avoid.length ? `避开：${profile.avoid.join("、")}` : "",
    profile.dietary.length ? `饮食要求：${profile.dietary.join("、")}` : "",
    profile.accessibility !== undefined ? `无障碍需求：${JSON.stringify(profile.accessibility)}` : "",
    profile.children !== undefined ? `儿童同行：${String(profile.children)}` : "",
    profile.elderly !== undefined ? `老人同行：${String(profile.elderly)}` : "",
    profile.budgetMode ? `预算模式：${profile.budgetMode}` : "",
    profile.socialOptIn ? "用户同意参考社交平台攻略，但社交内容不能替代实时事实。" : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function placeText(place: Place) {
  return [place.name, place.address, place.district, place.description, ...place.tags]
    .join(" ")
    .toLocaleLowerCase();
}

function matchesTerm(place: Place, term: string) {
  const needle = normalizeText(term);
  return Boolean(needle) && placeText(place).includes(needle);
}

function walkingIntensive(place: Place) {
  return /山|步道|徒步|爬坡|登山|长距离|峡谷|栈道|古镇/.test(placeText(place));
}

/** Apply only constraints that are provable from provider candidate metadata. */
export function filterPlanningCandidates(
  candidates: Place[],
  profile: PlanningProfile,
  days = profile.days ?? 1,
) {
  const avoided = candidates.filter((place) => profile.avoid.some((term) => matchesTerm(place, term)));
  const nonAvoided = candidates.filter((place) => !avoided.includes(place));
  const must = nonAvoided.filter((place) => profile.mustVisit.some((term) => matchesTerm(place, term)));
  const lowWalkingPool = profile.walkingTolerance === "low"
    ? nonAvoided.filter((place) => !walkingIntensive(place))
    : nonAvoided;
  const walkingPool = lowWalkingPool.length >= Math.max(1, Math.min(days, 2)) ? lowWalkingPool : nonAvoided;
  const nonMust = walkingPool.filter((place) => !must.includes(place));
  if (profile.budgetMode === "tight") {
    nonMust.sort((left, right) => (left.estimatedCost ?? left.priceLevel * 50) - (right.estimatedCost ?? right.priceLevel * 50));
  }
  const ordered = [...must, ...nonMust];
  const unique = [...new Map(ordered.map((place) => [place.id, place])).values()];
  if (profile.pace !== "relaxed") return unique;
  const limit = Math.max(must.length, Math.max(1, days) * 2);
  return unique.slice(0, limit);
}

export function isPlanningPlaceAvoided(place: Place, profile: PlanningProfile) {
  return profile.avoid.some((term) => matchesTerm(place, term));
}

export function isPlanningPlaceMustVisit(place: Place, profile: PlanningProfile) {
  return profile.mustVisit.some((term) => matchesTerm(place, term));
}
