import type { Place } from "@/types/travel";
import type { DayPeriod, PlaceScheduleProfile } from "./types";

/**
 * Keyword predicates live here (not in the adapter, not in the LLM prompt) so
 * the schedule reacts to provable place metadata only. The exertion regex
 * mirrors the one used by planning/profile.ts candidate filtering.
 */
const EXERTION_PATTERN = /山|步道|徒步|爬坡|登山|长距离|峡谷|栈道|古镇/;
const INDOOR_PATTERN = /博物馆|美术馆|展览|纪念馆|科技馆|图书馆|商场|室内/;
const NIGHT_PATTERN = /夜景|夜市|夜景|观景台|night|灯塔|江景/;

export function describePlace(place: Place, originalOrder: number): PlaceScheduleProfile {
  const text = `${place.name} ${place.category} ${place.description ?? ""} ${place.tags?.join(" ") ?? ""}`;
  const periods: DayPeriod[] = [];
  let indoor = false;
  let eveningOriented = false;
  let highExertion = false;

  if (place.category === "viewpoint" || NIGHT_PATTERN.test(text)) {
    // Views and night scenes belong to dusk or later.
    periods.push("evening", "night");
    eveningOriented = true;
  }
  if (place.category === "food") {
    periods.push("noon", "evening");
  }
  if (place.category === "cafe") {
    periods.push("morning", "afternoon");
  }
  if (!periods.length) {
    periods.push("morning", "afternoon");
  }
  if (place.category === "shopping" || place.category === "cafe" || INDOOR_PATTERN.test(text) || place.category === "hotel") {
    indoor = true;
  }
  if (EXERTION_PATTERN.test(text)) {
    highExertion = true;
  }
  return {
    place,
    originalOrder,
    periods,
    indoor,
    highExertion,
    eveningOriented,
    estimatedStayMinutes: place.stayMinutes && place.stayMinutes > 0 ? place.stayMinutes : 60,
    openingHoursKnown: false,
  };
}

export function isRainy(weather?: { condition?: string; icon?: string }) {
  if (!weather) return false;
  return Boolean(weather.icon === "rain" || (weather.condition ?? "").includes("雨"));
}
