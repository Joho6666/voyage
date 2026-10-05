import type { PlanningProfile } from "@/schemas/planning";
import type { Place, Trip } from "@/types/travel";
import { clusterByGeography } from "./cluster";
import { buildDayPlans, estimateDayWalking } from "./schedule";
import { describePlace } from "./time-windows";
import { validateAssignments } from "./validate";
import type { OptimizerDecision, OptimizerInput, OptimizerOutput, PlaceScheduleProfile } from "./types";
import { DEFAULT_WEIGHTS } from "./types";

export * from "./types";

/**
 * Guide-import entry point: turns an ordered candidate list into per-day
 * assignments. Pure function — no providers, no clock, no repository — so it
 * runs identically on the server (planning generate route) and in the browser
 * (guide panel), and is deterministic for tests.
 */
export function optimizeGuideDayAssignment(input: OptimizerInput): OptimizerOutput {
  const weights = { ...DEFAULT_WEIGHTS, ...input.weights };
  const profile = input.profile ?? null;
  const decisions: OptimizerDecision[] = [];
  const warnings: OptimizerOutput["warnings"] = [];

  const avoidTerms = profile?.avoid?.map((term) => term.trim()).filter(Boolean) ?? [];
  const kept = input.places.filter((place) => {
    const excluded = avoidTerms.some((term) => place.name.includes(term));
    if (excluded) {
      warnings.push(`已按 avoid 偏好排除「${place.name}」`);
    }
    return !excluded;
  });
  const profiles = kept.map((place, index) => describePlace(place, index));

  const evaluate = (clusters: PlaceScheduleProfile[][]) => {
    const { plans, decisions: scheduleDecisions, warnings: scheduleWarnings } = buildDayPlans(clusters, {
      days: input.days,
      hotel: input.hotel ?? null,
      profile,
      weights,
    });
    const total = plans.reduce((sum, plan) => sum + estimateDayWalking(plan, input.hotel ?? null), 0);
    return { plans, scheduleDecisions, scheduleWarnings, total };
  };

  // Two candidate day-assignments, same within-day scheduling:
  //  1. geographic clustering — wins when POIs group naturally;
  //  2. original guide order, chunked evenly — wins on spread POI sets with
  //     few days, where clustering can split a compact guide sweep into
  //     longer cross-town chains.
  const clusters = clusterByGeography(profiles, Math.max(1, input.days.length));
  const clustered = evaluate(clusters);
  const naiveChunks = chunkEvenly(profiles, Math.max(1, input.days.length));
  const originalOrder = naiveChunks.length ? evaluate(naiveChunks) : null;
  const chosen = originalOrder && originalOrder.total < clustered.total ? originalOrder : clustered;

  if (chosen === clustered) {
    clusters.forEach((cluster, index) => {
      if (cluster.length > 1) {
        const span = Math.round(
          Math.max(...cluster.map((member) => distanceToClusterCenter(member, cluster))),
        );
        decisions.push({
          dayId: input.days[index]?.dayId ?? `day-${index}`,
          kind: "geo_cluster",
          reason: `Day ${index + 1} 聚类 ${cluster.length} 个地理相近地点（${cluster.map((member) => member.place.name).slice(0, 3).join("、")}${cluster.length > 3 ? " 等" : ""}），最远相距约 ${span} m`,
        });
      }
    });
  } else {
    decisions.push({
      dayId: chosen.plans[0]?.dayId ?? input.days[0]?.dayId ?? "day-1",
      kind: "order",
      reason: `攻略原始顺序的每日步行比地理聚类少约 ${Math.round(clustered.total - originalOrder!.total)} 米，已按原始顺序分配`,
    });
  }
  decisions.push(...chosen.scheduleDecisions);
  warnings.push(...chosen.scheduleWarnings);

  const plans = chosen.plans;
  const assignments = plans.map((plan) => ({
    dayId: plan.dayId,
    places: plan.members.map((member) => member.place),
  }));
  const scheduled = plans.flatMap((plan) => plan.members);
  const { warnings: validateWarnings, unresolvedConstraints } = validateAssignments(assignments, scheduled, input);
  warnings.push(...validateWarnings);

  const estimatedWalkingMetersByDay: Record<string, number> = {};
  plans.forEach((plan) => {
    estimatedWalkingMetersByDay[plan.dayId] = estimateDayWalking(plan, input.hotel ?? null);
  });
  const metrics = {
    estimatedWalkingMetersByDay,
    totalEstimatedWalkingMeters: Object.values(estimatedWalkingMetersByDay).reduce((sum, value) => sum + value, 0),
  };
  return { assignments, decisions, warnings, unresolvedConstraints, metrics };
}

/** Original-order chunks, one per day at most (benchmark baseline rubric). */
function chunkEvenly(profiles: PlaceScheduleProfile[], dayCount: number): PlaceScheduleProfile[][] {
  if (dayCount <= 0 || !profiles.length) return [];
  const per = Math.ceil(profiles.length / dayCount);
  const chunks: PlaceScheduleProfile[][] = [];
  for (let index = 0; index < profiles.length; index += per) {
    const chunk = profiles.slice(index, index + per);
    if (chunk.length) chunks.push(chunk);
  }
  return chunks;
}

function distanceToClusterCenter(member: PlaceScheduleProfile, cluster: PlaceScheduleProfile[]): number {
  const lat = cluster.reduce((sum, current) => sum + current.place.lat, 0) / cluster.length;
  const lng = cluster.reduce((sum, current) => sum + current.place.lng, 0) / cluster.length;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(member.place.lat - lat);
  const dLng = toRad(member.place.lng - lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(member.place.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export interface TripPlanResult {
  /** Trip clone with planned items reassigned; times/segments NOT recomputed (runtime owns that). */
  trip: Trip;
  changedDayIds: string[];
  optimization: OptimizerOutput;
}

/**
 * Runtime entry point for optimize-itinerary: reschedules only `planned`
 * items of an existing trip. done/current/skipped items stay on their day in
 * their original order, so completion history is never rewritten. Pure — the
 * runtime applies the result, recomputes routes, and drives the proposal flow.
 */
export function optimizeTripPlan(input: { trip: Trip; profile?: PlanningProfile | null }): TripPlanResult | null {
  const { trip } = input;
  const plannedItems = trip.items.filter((item) => item.status === "planned");
  if (!plannedItems.length) return null;

  const placesById = new Map(trip.places.map((place) => [place.id, place]));
  const plannedPlaces: Place[] = [];
  const itemsByPlaceId = new Map<string, typeof plannedItems[number][]>();
  for (const item of plannedItems) {
    const place = placesById.get(item.placeId);
    if (!place) continue;
    if (!itemsByPlaceId.has(place.id)) {
      plannedPlaces.push(place);
      itemsByPlaceId.set(place.id, []);
    }
    itemsByPlaceId.get(place.id)!.push(item);
  }
  if (!plannedPlaces.length) return null;

  const hotel = trip.places.find((candidate) => candidate.category === "hotel") ?? null;
  const optimization = optimizeGuideDayAssignment({
    places: plannedPlaces,
    days: trip.days.map((day) => ({ dayId: day.id, date: day.date, weather: { condition: day.weather?.condition, icon: day.weather?.icon } })),
    profile: input.profile ?? trip.planningMetadata?.planningProfile ?? null,
    hotel,
  });

  const next = structuredClone(trip);
  const orderCursor = new Map<string, number>();
  // Preserved items keep their day and relative order; planned items follow.
  for (const item of next.items) {
    if (item.status !== "planned") {
      const current = orderCursor.get(item.dayId) ?? 0;
      item.order = current;
      orderCursor.set(item.dayId, current + 1);
    }
  }
  for (const assignment of optimization.assignments) {
    for (const place of assignment.places) {
      const items = itemsByPlaceId.get(place.id);
      const item = items?.shift();
      if (!item) continue;
      item.dayId = assignment.dayId;
      const current = orderCursor.get(assignment.dayId) ?? 0;
      item.order = current;
      orderCursor.set(assignment.dayId, current + 1);
    }
  }
  // Drop any planned item whose place vanished from the pool (defensive).
  const assignedIds = new Set(optimization.assignments.flatMap((assignment) => assignment.places.map((place) => place.id)));
  next.items = next.items.filter((item) => item.status !== "planned" || assignedIds.has(item.placeId));

  const changedDayIds = trip.days
    .filter((day) => {
      const before = trip.items.filter((item) => item.dayId === day.id).map((item) => item.id);
      const after = next.items.filter((item) => item.dayId === day.id).map((item) => item.id);
      return before.join("|") !== after.join("|");
    })
    .map((day) => day.id);
  return { trip: next, changedDayIds, optimization };
}
