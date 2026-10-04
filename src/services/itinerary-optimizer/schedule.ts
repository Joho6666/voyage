import { haversineMeters } from "@/lib/utils";
import type { PlanningProfile } from "@/schemas/planning";
import type { Place } from "@/types/travel";
import type { OptimizerDay, OptimizerDecision, OptimizerWeights, PlaceScheduleProfile } from "./types";
import { isRainy } from "./time-windows";

export interface ScheduleContext {
  days: OptimizerDay[];
  hotel?: { lat: number; lng: number } | null;
  profile?: PlanningProfile | null;
  weights: OptimizerWeights;
}

export interface DayPlan {
  dayId: string;
  members: PlaceScheduleProfile[];
}

const WALKING_BUDGET_METERS = 4000;

function chainMeters(places: Place[], hotel?: { lat: number; lng: number } | null): number {
  let total = 0;
  let previous: { lat: number; lng: number } | null = hotel ?? null;
  for (const place of places) {
    if (previous) total += haversineMeters(previous, place);
    previous = place;
  }
  return total;
}

function nearestNeighbourChain(members: PlaceScheduleProfile[], anchor: { lat: number; lng: number } | null): PlaceScheduleProfile[] {
  const remaining = [...members];
  const chain: PlaceScheduleProfile[] = [];
  let current: { lat: number; lng: number } | null = anchor;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((member, index) => {
      const reference = current ?? anchor;
      const distance = haversineMeters(member.place, reference ?? member.place);
      // Ties resolve by guide order so the original sweep survives as a signal.
      if (distance < bestDistance - 1 || (Math.abs(distance - bestDistance) <= 1 && member.originalOrder < remaining[bestIndex].originalOrder)) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    chain.push(next);
    current = next.place;
  }
  return chain;
}

function dayLimit(profile: PlanningProfile | null | undefined): number {
  const base = profile?.pace === "relaxed" ? 3 : profile?.pace === "packed" ? 6 : 4;
  const companions = Boolean(profile && (profile.elderly || profile.children));
  return Math.max(2, companions ? base - 1 : base);
}

function pickTargetDay(plans: DayPlan[], fromIndex: number, days: OptimizerDay[], limit?: (plan: DayPlan) => boolean): number {
  let best = -1;
  let bestSize = Number.POSITIVE_INFINITY;
  plans.forEach((plan, index) => {
    if (index === fromIndex || !plan.members.length) return;
    if (limit && !limit(plan)) return;
    if (isRainy(days[index]?.weather)) return;
    if (plan.members.length < bestSize) {
      best = index;
      bestSize = plan.members.length;
    }
  });
  if (best >= 0) return best;
  // Every other day is rainy or empty: fall back to the fewest-members day
  // regardless of weather rather than dropping the place.
  plans.forEach((plan, index) => {
    if (index === fromIndex) return;
    if (plan.members.length < bestSize) {
      best = index;
      bestSize = plan.members.length;
    }
  });
  return best;
}

/**
 * Turns geographic clusters into ordered day plans: weather first (rain keeps
 * indoor places, sheds outdoor exertion), then pace caps, then the in-day
 * chain (nearest-neighbour from the hotel, evening views last, meals anchored
 * away from the morning start), then a walking-budget pass for low tolerance.
 * Every move records a decision with the real numbers behind it.
 */
export function buildDayPlans(clusters: PlaceScheduleProfile[][], context: ScheduleContext): {
  plans: DayPlan[];
  decisions: OptimizerDecision[];
  warnings: string[];
} {
  const { days, hotel, profile } = context;
  const decisions: OptimizerDecision[] = [];
  const warnings: string[] = [];
  const plans: DayPlan[] = clusters.map((members, index) => ({ dayId: days[index]?.dayId ?? `day-${index}`, members }));

  // Weather pass: rainy days keep indoor places and shed outdoor exertion.
  plans.forEach((plan, index) => {
    if (!isRainy(days[index]?.weather)) return;
    const dayLabel = `Day ${index + 1}`;
    const indoorCount = plan.members.filter((member) => member.indoor).length;
    if (indoorCount) {
      decisions.push({ dayId: plan.dayId, kind: "weather", reason: `${dayLabel}预报有雨，${indoorCount} 个室内/遮蔽类地点优先保留在当天` });
    }
    const exposed = plan.members.filter((member) => !member.indoor && member.highExertion);
    for (const member of exposed) {
      const target = pickTargetDay(plans, index, days);
      if (target < 0) break;
      plans[index].members = plans[index].members.filter((candidate) => candidate !== member);
      plans[target].members.push(member);
      decisions.push({
        dayId: plans[target].dayId,
        kind: "weather",
        reason: `${dayLabel}预报有雨，高体力户外地点「${member.place.name}」移至 Day ${target + 1}`,
      });
    }
  });

  // Pace pass: keep each day within the profile's density.
  const limit = dayLimit(profile);
  plans.forEach((plan, index) => {
    while (plan.members.length > limit) {
      const evictable = plan.members.filter((member) => !isMustVisit(member, profile));
      const pool = evictable.length ? evictable : plan.members;
      // The most isolated member fits the day worst.
      let worst = pool[0];
      let worstDistance = -1;
      for (const member of pool) {
        const others = plan.members.filter((candidate) => candidate !== member);
        const distance = others.length ? Math.min(...others.map((other) => haversineMeters(member.place, other.place))) : Number.POSITIVE_INFINITY;
        if (distance > worstDistance) {
          worstDistance = distance;
          worst = member;
        }
      }
      const target = pickTargetDay(plans, index, days);
      if (target < 0) break;
      plans[index].members = plans[index].members.filter((candidate) => candidate !== worst);
      plans[target].members.push(worst);
      decisions.push({
        dayId: plans[target].dayId,
        kind: "profile",
        reason: `Day ${index + 1} 超出「${profile?.pace ?? "balanced"}」节奏上限（${limit} 站/天），「${worst.place.name}」移至 Day ${target + 1}`,
      });
    }
  });

  // In-day ordering pass.
  plans.forEach((plan, index) => {
    if (!plan.members.length) return;
    const rainy = isRainy(days[index]?.weather);
    let chain = nearestNeighbourChain(plan.members, hotel ?? null);
    if (rainy) {
      const indoorFirst = [...chain].sort((left, right) => Number(right.indoor) - Number(left.indoor));
      if (indoorFirst.some((member, position) => member !== chain[position])) {
        decisions.push({ dayId: plan.dayId, kind: "weather", reason: `Day ${index + 1} 有雨，当日路线按室内优先重排` });
      }
      chain = indoorFirst;
    }
    // Evening views go last: they only make sense after dusk.
    const evening = chain.filter((member) => member.eveningOriented);
    if (evening.length && evening.length < chain.length) {
      chain = [...chain.filter((member) => !member.eveningOriented), ...evening];
      decisions.push({
        dayId: plan.dayId,
        kind: "time_window",
        reason: `${evening.map((member) => `「${member.place.name}」`).join("、")}为观景/夜景类地点，安排在 Day ${index + 1} 晚间档`,
      });
    }
    // Meals should not open the day; anchor the first food after the middle.
    const firstFoodIndex = chain.findIndex((member) => member.place.category === "food");
    if (firstFoodIndex === 0 && chain.length >= 3) {
      const middle = Math.floor(chain.length / 2);
      const [food] = chain.splice(0, 1);
      chain.splice(middle - 1, 0, food);
      decisions.push({ dayId: plan.dayId, kind: "time_window", reason: `「${food.place.name}」为餐饮，锚定 Day ${index + 1} 正餐时段而非开门第一站` });
    }
    plan.members = chain;
  });

  // Walking-budget pass for low tolerance: shed the most isolated place until
  // the estimated chain fits the budget.
  if (profile?.walkingTolerance === "low") {
    plans.forEach((plan, index) => {
      let estimated = chainMeters(plan.members.map((member) => member.place), hotel ?? null);
      while (estimated > WALKING_BUDGET_METERS && plan.members.length > 2) {
        let worst = plan.members[0];
        let worstDistance = -1;
        for (const member of plan.members) {
          const others = plan.members.filter((candidate) => candidate !== member);
          const distance = others.length ? Math.min(...others.map((other) => haversineMeters(member.place, other.place))) : 0;
          if (distance > worstDistance) {
            worstDistance = distance;
            worst = member;
          }
        }
        const target = pickTargetDay(plans, index, days, (candidatePlan) => chainMeters(candidatePlan.members.map((member) => member.place), hotel ?? null) <= WALKING_BUDGET_METERS);
        if (target < 0) break;
        const afterRemoval = plan.members.filter((member) => member !== worst);
        estimated = chainMeters(afterRemoval.map((member) => member.place), hotel ?? null);
        plans[index].members = afterRemoval;
        plans[target].members.push(worst);
        decisions.push({
          dayId: plans[target].dayId,
          kind: "walking_budget",
          reason: `Day ${index + 1} 估算步行 ${Math.round(estimated + worstDistance)} m 超出低步行耐受预算（约 ${WALKING_BUDGET_METERS} m），「${worst.place.name}」移至 Day ${target + 1}`,
        });
      }
    });
  }

  return { plans, decisions, warnings };
}

function isMustVisit(member: PlaceScheduleProfile, profile: PlanningProfile | null | undefined) {
  if (!profile?.mustVisit?.length) return false;
  const text = `${member.place.name}`;
  return profile.mustVisit.some((term) => text.includes(term.trim()));
}

/** Straight-line walking estimate per day (hotel→first→…→last); labeled as an estimate everywhere it surfaces. */
export function estimateDayWalking(plan: DayPlan, hotel?: { lat: number; lng: number } | null): number {
  return Math.round(chainMeters(plan.members.map((member) => member.place), hotel ?? null));
}
