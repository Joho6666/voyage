import type { Place } from "@/types/travel";

export interface RulePlanningInput {
  destination: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  vibes: string[];
  candidates: Place[];
}

export interface RulePlanStop {
  placeId: string;
  startTime: string;
  durationMinutes: number;
  meal?: "lunch" | "dinner";
}

export interface RulePlan {
  title: string;
  dayPlans: Array<{ title: string; summary: string; stops: RulePlanStop[] }>;
}

export function createTripId() {
  return crypto.randomUUID();
}

function dayCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const end = new Date(`${endDate}T12:00:00`).getTime();
  return Math.max(1, Math.min(7, Math.floor((end - start) / 86_400_000) + 1));
}

function addMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = (h || 0) * 60 + (m || 0) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Deterministic planner. Every stop references a server-provided candidate ID. */
export function planWithRules(input: RulePlanningInput): RulePlan {
  const count = dayCount(input.startDate, input.endDate);
  const usable = input.candidates.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (usable.length === 0) throw new Error("NO_POI_RESULTS");
  const attractions = usable.filter((p) => ["attraction", "viewpoint", "activity", "shopping"].includes(p.category));
  const food = usable.filter((p) => ["food", "cafe"].includes(p.category));
  const pool = attractions.length || food.length ? [...attractions, ...food] : usable;
  const used = new Set<string>();
  const dayPlans = Array.from({ length: count }, (_, dayIndex) => {
    const stops: RulePlanStop[] = [];
    const remainingDays = count - dayIndex;
    const remainingPlaces = pool.length - used.size;
    const maxStops = Math.max(1, Math.min(4, Math.floor(remainingPlaces / remainingDays)));
    let cursor = "09:00";
    const take = (predicate: (p: Place) => boolean, meal?: "lunch" | "dinner") => {
      const candidate = pool.find((p) => !used.has(p.id) && predicate(p));
      if (!candidate) return;
      used.add(candidate.id);
      stops.push({ placeId: candidate.id, startTime: cursor, durationMinutes: candidate.stayMinutes || 60, ...(meal ? { meal } : {}) });
      cursor = addMinutes(cursor, (candidate.stayMinutes || 60) + 35);
    };
    take((p) => p.category !== "food" && p.category !== "cafe");
    if (stops.length < maxStops) take((p) => p.category === "food", "lunch");
    if (stops.length < maxStops) take((p) => p.category !== "food" && p.category !== "cafe");
    if (stops.length < maxStops) take((p) => p.category === "food" || p.category === "cafe", "dinner");
    if (!stops.length) take(() => true);
    return { title: `${input.destination} · Day ${dayIndex + 1}`, summary: input.vibes.length ? input.vibes.join("、") : "按地理就近安排", stops };
  });
  return { title: `${input.destination} · ${count} 天`, dayPlans };
}
