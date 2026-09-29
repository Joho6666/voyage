import { MAX_TRIP_DAYS } from "@/lib/trip-limits";
import type { PlanningProfileDraft } from "@/components/planning/types";

/** Days between two ISO dates, inclusive; undefined when the range is invalid. */
export function draftDateSpan(profile: PlanningProfileDraft) {
  if (!profile.startDate || !profile.endDate) return undefined;
  const start = Date.parse(`${profile.startDate}T12:00:00Z`);
  const end = Date.parse(`${profile.endDate}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/**
 * A date range that cannot become a trip is a blocker, not a warning. A past
 * departure is only warned about, because planning a trip that already started
 * is a legitimate choice.
 */
export function dateRangeWarning(profile: PlanningProfileDraft) {
  const span = draftDateSpan(profile);
  if (span !== undefined && span > MAX_TRIP_DAYS) {
    return `出发与返程相隔 ${span} 天，超过可生成的上限 ${MAX_TRIP_DAYS} 天，请确认日期是否填错。`;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (profile.startDate && profile.startDate < today) {
    return `出发日期 ${profile.startDate} 已经过去，如果不是有意的请重新选择。`;
  }
  return "";
}

/**
 * Preconditions the generate endpoint enforces. Reads the same shared constant
 * the server does, so the panel can never again allow a plan the runtime will
 * refuse (the two caps once drifted: 31 client vs 7 server).
 */
export function generateBlockersFor(profile: PlanningProfileDraft, days?: number) {
  const blockers: string[] = [];
  if (!profile.destination.trim()) blockers.push("目的地");
  if (!profile.startDate) blockers.push("出发日期");
  if (!profile.endDate && !days) blockers.push("返程日期或旅行天数");
  const span = draftDateSpan(profile);
  if (span !== undefined && span > MAX_TRIP_DAYS) blockers.push("日期跨度");
  return blockers;
}

function listFromDraft(value: string) {
  return value.split(/[,，、；;]+/).map((item) => item.trim()).filter(Boolean);
}

function asNumber(value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value.replace(/[,，¥￥\s]/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

/** The structured profile patch sent with each conversational turn. */
export function profilePatchFromDraft(profile: PlanningProfileDraft) {
  const pace = profile.pace === "轻松留白" ? "relaxed" : profile.pace === "刚好充实" ? "balanced" : profile.pace === "特种兵一点" ? "packed" : undefined;
  const walkingTolerance = profile.walkingTolerance === "少走路" ? "low" : profile.walkingTolerance === "适中" ? "medium" : profile.walkingTolerance === "可以多走一点" ? "high" : undefined;
  const transportPreference = profile.transportPreference === "公共交通优先" ? "public" : profile.transportPreference === "混合安排" ? "mixed" : profile.transportPreference === "打车更方便" ? "taxi" : undefined;
  const travelers = asNumber(profile.travelers);
  const budget = asNumber(profile.budget);
  return {
    ...(profile.origin.trim() ? { origin: profile.origin.trim() } : {}),
    ...(profile.destination.trim() ? { destination: profile.destination.trim() } : {}),
    ...(profile.startDate ? { startDate: profile.startDate } : {}),
    ...(profile.endDate ? { endDate: profile.endDate } : {}),
    ...(travelers !== undefined ? { travelers } : {}),
    ...(budget !== undefined ? { budget } : {}),
    ...(pace ? { pace } : {}),
    ...(walkingTolerance ? { walkingTolerance } : {}),
    ...(transportPreference ? { transportPreference } : {}),
    ...(profile.vibes.length ? { vibes: profile.vibes } : {}),
    ...(profile.mustVisit.trim() ? { mustVisit: listFromDraft(profile.mustVisit) } : {}),
    ...(profile.avoid.trim() ? { avoid: listFromDraft(profile.avoid) } : {}),
    includeExternalOffers: profile.includeOffers,
    socialOptIn: profile.includeSocialEvidence,
  };
}
