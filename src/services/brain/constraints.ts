import { haversineMeters } from "@/lib/utils";
import { estimateCost } from "@/services/transport/options";
import type { PlanningProfile } from "@/schemas/planning";
import type { ConstraintEvaluation, RepairHint, RouteMatrix } from "@/schemas/brain";
import type { Outline } from "@/services/planning/outline-planner";
import type { Place } from "@/types/travel";

/**
 * ConstraintEngine v1 (Travel Brain Phase 4.1).
 *
 * Deterministic gate between the planner and the itinerary compiler: the
 * outline is checked against hard constraints the traveller actually stated
 * (must-visit, avoid, dates, opening hours, budget floor, reachability) plus a
 * few cheap soft penalties. No LLM involvement — violations come with repair
 * hints, and `repairOutline` applies them in one deterministic pass.
 */

/** Terms match against the same fields the runtime's own warning check uses. */
export function placeMatchesTerm(place: Place, term: string) {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return false;
  return [place.name, place.address, place.district, place.description, ...place.tags]
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

export interface OutlineConstraintContext {
  /** Full provider candidate pool — the only places a repair may introduce. */
  candidates: Place[];
  profile?: PlanningProfile;
  matrix?: RouteMatrix;
  expectedDays: number;
  budget: number;
  travelers: number;
  /** Per-place spend floor (CNY/person). Mirrors the tight-budget heuristic. */
  estimatePlaceCost?: (place: Place) => number;
}

interface OpeningRange {
  start: number;
  end: number;
}

/** Parses "09:00-17:00" (comma/、/；separated ranges, cross-midnight aware). */
function parseOpeningHours(raw: string | undefined): OpeningRange[] | undefined {
  if (!raw) return undefined;
  const ranges: OpeningRange[] = [];
  const matches = raw.matchAll(/(\d{1,2}):(\d{2})\s*[-–~至]\s*(\d{1,2}):(\d{2})/g);
  for (const match of matches) {
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ start, end });
  }
  return ranges.length ? ranges : undefined;
}

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmmOf(totalMinutes: number) {
  const clamped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function defaultPlaceCost(place: Place) {
  return place.estimatedCost ?? place.priceLevel * 50;
}

function edgeMinutes(matrix: RouteMatrix | undefined, fromId: string, toId: string) {
  if (!matrix) return undefined;
  return matrix.edges.find(
    (edge) => (edge.fromPlaceId === fromId && edge.toPlaceId === toId) || (edge.fromPlaceId === toId && edge.toPlaceId === fromId),
  );
}

function dayLegs(outline: Outline, placeById: Map<string, Place>) {
  const legs: Array<{ dayIndex: number; from: Place; to: Place; meters: number }> = [];
  outline.dayPlans.forEach((day, dayIndex) => {
    for (let i = 0; i < day.stops.length - 1; i += 1) {
      const from = placeById.get(day.stops[i].placeId);
      const to = placeById.get(day.stops[i + 1].placeId);
      if (from && to) legs.push({ dayIndex, from, to, meters: haversineMeters(from, to) });
    }
  });
  return legs;
}

/** Transport + per-person spend floor for every stop in the outline. */
export function outlineSpendFloor(outline: Outline, ctx: OutlineConstraintContext): { total: number; places: number; transport: number } {
  const placeById = new Map(ctx.candidates.map((place) => [place.id, place]));
  const perPerson = ctx.estimatePlaceCost ?? defaultPlaceCost;
  let placesTotal = 0;
  for (const stop of outline.dayPlans.flatMap((day) => day.stops)) {
    const place = placeById.get(stop.placeId);
    if (place) placesTotal += perPerson(place);
  }
  const mode = ctx.matrix?.mode ?? "walk";
  let transport = 0;
  for (const leg of dayLegs(outline, placeById)) {
    const edge = edgeMinutes(ctx.matrix, leg.from.id, leg.to.id);
    if (edge) {
      transport += edge.costCny;
    } else {
      const cost = estimateCost(mode, leg.meters, ctx.travelers);
      transport += (cost.min + cost.max) / 2;
    }
  }
  const placesWithTravelers = placesTotal * Math.max(1, ctx.travelers);
  return { total: Math.round(placesWithTravelers + transport), places: Math.round(placesWithTravelers), transport: Math.round(transport) };
}

const WALKING_TOLERANCE_KM: Record<NonNullable<PlanningProfile["walkingTolerance"]>, number> = {
  low: 8,
  medium: 15,
  high: 25,
};

const PACE_MAX_STOPS: Record<NonNullable<PlanningProfile["pace"]>, number> = {
  relaxed: 3,
  balanced: 5,
  packed: 6,
};

/** Deterministic hard/soft evaluation of an outline against the profile. */
export function evaluateOutline(outline: Outline, ctx: OutlineConstraintContext): ConstraintEvaluation {
  const hardViolations: ConstraintEvaluation["hardViolations"] = [];
  const softPenalties: ConstraintEvaluation["softPenalties"] = [];
  const warnings: string[] = [];
  const repairHints: RepairHint[] = [];
  const uncertainties: string[] = [];

  const placeById = new Map(ctx.candidates.map((place) => [place.id, place]));
  const profile = ctx.profile;
  const allStops = outline.dayPlans.flatMap((day) => day.stops);

  // 1. Day count: the outline must cover exactly the trip's days.
  if (outline.dayPlans.length !== ctx.expectedDays) {
    hardViolations.push({
      constraintId: "dates",
      detail: `行程只有 ${outline.dayPlans.length} 天，旅行共 ${ctx.expectedDays} 天`,
      severity: "error",
    });
    repairHints.push({ kind: "padDays", target: "*", reason: `补齐/裁剪到 ${ctx.expectedDays} 天` });
  }

  // 2. mustVisit: every stated must-visit place must be matched by a candidate
  //    AND appear in the outline.
  for (const term of profile?.mustVisit ?? []) {
    const matchedCandidates = ctx.candidates.filter((place) => placeMatchesTerm(place, term));
    if (!matchedCandidates.length) {
      warnings.push(`必去「${term}」在候选地点中无匹配，无法保证排入`);
      continue;
    }
    const scheduled = allStops.some((stop) => matchedCandidates.some((place) => place.id === stop.placeId));
    if (!scheduled) {
      hardViolations.push({ constraintId: `mustVisit:${term}`, detail: `必去「${term}」未排入行程`, severity: "error" });
      repairHints.push({ kind: "insertPlace", target: term, reason: "必去地点缺失" });
    }
  }

  // 3. avoid: no stop may match an avoid term.
  for (const term of profile?.avoid ?? []) {
    for (const day of outline.dayPlans) {
      for (const stop of day.stops) {
        const place = placeById.get(stop.placeId);
        if (place && placeMatchesTerm(place, term)) {
          hardViolations.push({ constraintId: `avoid:${term}`, detail: `「${place.name}」命中避开条件「${term}」`, severity: "error" });
          repairHints.push({ kind: "replacePlace", target: stop.placeId, reason: `命中避开条件「${term}」` });
        }
      }
    }
  }

  // 4. Opening hours: a parseable window that excludes startTime is a hard
  //    violation; unknown windows are reported as uncertainty, never guessed.
  for (const [dayIndex, day] of outline.dayPlans.entries()) {
    for (const stop of day.stops) {
      const place = placeById.get(stop.placeId);
      if (!place) continue;
      const ranges = parseOpeningHours(place.openingHours);
      if (!ranges) {
        if (place.openingHours === undefined) uncertainties.push(`${place.name}（营业时间未知）`);
        continue;
      }
      const start = minutesOf(stop.startTime);
      const within = ranges.some(({ start: open, end: close }) =>
        open <= close ? start >= open && start <= close : start >= open || start <= close,
      );
      if (!within) {
        const window = ranges.map(({ start: s, end: e }) => `${hhmmOf(s)}-${hhmmOf(e)}`).join("、");
        hardViolations.push({
          constraintId: `openingHours:${place.id}`,
          detail: `Day ${dayIndex + 1}「${place.name}」${stop.startTime} 到达，但营业时间为 ${window}`,
          severity: "error",
        });
        repairHints.push({ kind: "shiftTime", target: stop.placeId, reason: `调整到营业时间 ${window} 内` });
      }
    }
  }

  // 5. Budget floor: stop spend + transport along the plan. Stays/offers are
  //    not included — exceeding the floor is a certain overrun, not an estimate.
  const floor = outlineSpendFloor(outline, ctx);
  if (ctx.budget > 0 && floor.total > ctx.budget) {
    hardViolations.push({
      constraintId: "budgetCeiling",
      detail: `仅门票/餐饮+市内交通的保底花费已约 ¥${floor.total}，超出总预算 ¥${ctx.budget}`,
      severity: "error",
    });
    repairHints.push({ kind: "dropStop", target: "*", reason: "剔除花费最高的非必去地点" });
  }

  // 6. Reachability: an intra-city leg beyond 40km signals a broken ordering.
  for (const leg of dayLegs(outline, placeById)) {
    if (leg.meters > 40_000) {
      hardViolations.push({
        constraintId: "reachability",
        detail: `「${leg.from.name}」→「${leg.to.name}」直线 ${Math.round(leg.meters / 1000)}km，不像同一天顺路`,
        severity: "warn",
      });
      repairHints.push({ kind: "reorder", target: `day:${leg.dayIndex}`, reason: "跨区折返过大，按就近重排" });
      break;
    }
  }

  // Soft: daily moving distance vs walking tolerance.
  const toleranceKm = WALKING_TOLERANCE_KM[profile?.walkingTolerance ?? "medium"];
  outline.dayPlans.forEach((day, dayIndex) => {
    const meters = dayLegs({ ...outline, dayPlans: [day] }, placeById).reduce((sum, leg) => sum + leg.meters, 0);
    const km = meters / 1000;
    if (km > toleranceKm) {
      softPenalties.push({
        constraintId: `walking:day${dayIndex + 1}`,
        penalty: Math.min(30, Math.round((km - toleranceKm) * 3)),
        detail: `Day ${dayIndex + 1} 地点间距合计约 ${km.toFixed(1)}km，超过步行偏好（${toleranceKm}km 档）`,
      });
    }
  });

  // Soft: pace (stops per day).
  if (profile?.pace) {
    outline.dayPlans.forEach((day, dayIndex) => {
      const max = PACE_MAX_STOPS[profile.pace as NonNullable<PlanningProfile["pace"]>];
      if (day.stops.length > max) {
        softPenalties.push({
          constraintId: `pace:day${dayIndex + 1}`,
          penalty: Math.min(24, (day.stops.length - max) * 8),
          detail: `Day ${dayIndex + 1} 排了 ${day.stops.length} 站，超出「${profile.pace}」节奏（≤${max} 站）`,
        });
      }
    });
  }

  // Soft: backtracking — a day that re-enters a district it already left.
  outline.dayPlans.forEach((day, dayIndex) => {
    const seen = new Set<string>();
    let left = false;
    let revisits = 0;
    for (const stop of day.stops) {
      const district = placeById.get(stop.placeId)?.district;
      if (!district) continue;
      if (seen.has(district)) {
        if (left) revisits += 1;
      } else {
        if (seen.size > 0) left = true;
        seen.add(district);
      }
    }
    if (revisits > 0) {
      softPenalties.push({
        constraintId: `backtracking:day${dayIndex + 1}`,
        penalty: Math.min(20, revisits * 10),
        detail: `Day ${dayIndex + 1} 跨区折返 ${revisits} 次`,
      });
    }
  });

  // Soft: meal coverage — a day with no meal-tagged stop.
  outline.dayPlans.forEach((day, dayIndex) => {
    if (day.stops.length >= 2 && !day.stops.some((stop) => stop.meal === "lunch" || stop.meal === "dinner")) {
      softPenalties.push({
        constraintId: `meal:day${dayIndex + 1}`,
        penalty: 8,
        detail: `Day ${dayIndex + 1} 没有安排正餐`,
      });
    }
  });

  const hardErrorCount = hardViolations.filter((violation) => violation.severity === "error").length;
  const score = Math.max(0, 100 - hardErrorCount * 25 - softPenalties.reduce((sum, penalty) => sum + penalty.penalty, 0));

  for (const violation of hardViolations) warnings.push(violation.detail);
  for (const penalty of softPenalties) warnings.push(penalty.detail);
  if (uncertainties.length) {
    warnings.push(`营业时间未知，无法校验：${[...new Set(uncertainties)].slice(0, 5).join("、")}${uncertainties.length > 5 ? " 等" : ""}`);
  }

  return { hardViolations, softPenalties, score, warnings, repairHints };
}

export interface RepairResult {
  outline: Outline;
  applied: string[];
}

function nextStartTime(day: Outline["dayPlans"][number], placeById: Map<string, Place>) {
  const last = day.stops[day.stops.length - 1];
  if (!last) return "09:00";
  const duration = placeById.get(last.placeId)?.stayMinutes ?? last.durationMinutes;
  return hhmmOf(minutesOf(last.startTime) + duration + 45);
}

/**
 * One deterministic repair pass over the outline. Every hint is applied at
 * most once; anything not repaired surfaces again on re-evaluation and flows
 * into the trip warnings — nothing is silently dropped.
 */
export function repairOutline(outline: Outline, evaluation: ConstraintEvaluation, ctx: OutlineConstraintContext): RepairResult {
  const applied: string[] = [];
  let dayPlans = outline.dayPlans.map((day) => ({ ...day, stops: [...day.stops] }));
  const placeById = new Map(ctx.candidates.map((place) => [place.id, place]));
  const hints = evaluation.repairHints;
  const hintUsed = new Set<string>();

  const takeHint = (kind: RepairHint["kind"]) => {
    const index = hints.findIndex((hint) => hint.kind === kind && !hintUsed.has(hint.kind + hint.target));
    if (index === -1) return undefined;
    const hint = hints[index];
    hintUsed.add(hint.kind + hint.target);
    return hint;
  };

  // padDays: align the day count with the trip.
  const padHint = takeHint("padDays");
  if (padHint) {
    while (dayPlans.length < ctx.expectedDays) {
      dayPlans.push({ title: `Day ${dayPlans.length + 1}`, summary: "补充日，待安排", stops: [] });
      applied.push(`补齐空缺的 Day ${dayPlans.length}`);
    }
    if (dayPlans.length > ctx.expectedDays) {
      const dropped = dayPlans.slice(ctx.expectedDays);
      dayPlans = dayPlans.slice(0, ctx.expectedDays);
      applied.push(`裁剪超出旅行天数的 ${dropped.length} 天计划`);
    }
  }

  // insertPlace: missing must-visit stops are added to the geographically
  // closest day, after its last stop.
  for (const hint of hints.filter((candidate) => candidate.kind === "insertPlace")) {
    const term = hint.target;
    const inOutline = dayPlans.some((day) =>
      day.stops.some((stop) => {
        const place = placeById.get(stop.placeId);
        return place && placeMatchesTerm(place, term);
      }),
    );
    if (inOutline) continue;
    const candidate = ctx.candidates.find((place) =>
      placeMatchesTerm(place, term) && !dayPlans.some((day) => day.stops.some((stop) => stop.placeId === place.id)),
    );
    if (!candidate) continue;
    let bestDay = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    dayPlans.forEach((day, dayIndex) => {
      if (day.stops.length >= 10) return;
      const distance = day.stops.reduce((sum, stop) => {
        const place = placeById.get(stop.placeId);
        return sum + (place ? haversineMeters(place, candidate) : 0);
      }, 0) / Math.max(1, day.stops.length);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestDay = dayIndex;
      }
    });
    if (bestDay === -1) bestDay = 0;
    const day = dayPlans[bestDay];
    day.stops.push({
      placeId: candidate.id,
      startTime: nextStartTime(day, placeById),
      durationMinutes: candidate.stayMinutes || 90,
    });
    applied.push(`插入必去地点「${candidate.name}」到 Day ${bestDay + 1}`);
  }

  // replacePlace: swap avoided stops for the nearest same-category candidate
  // that does not match any avoid term; drop the stop when nothing qualifies.
  for (const hint of hints.filter((candidate) => candidate.kind === "replacePlace")) {
    const stopPlaceId = hint.target;
    const avoidTerms = ctx.profile?.avoid ?? [];
    let done = false;
    for (const day of dayPlans) {
      const index = day.stops.findIndex((stop) => stop.placeId === stopPlaceId);
      if (index === -1) continue;
      const current = placeById.get(stopPlaceId);
      const neighbours = [day.stops[index - 1], day.stops[index + 1]]
        .map((stop) => (stop ? placeById.get(stop.placeId) : undefined))
        .filter((place): place is Place => Boolean(place));
      const replacement = ctx.candidates
        .filter((place) =>
          place.id !== stopPlaceId &&
          place.category === current?.category &&
          !avoidTerms.some((term) => placeMatchesTerm(place, term)) &&
          !dayPlans.some((anyDay) => anyDay.stops.some((stop) => stop.placeId === place.id)),
        )
        .sort((a, b) => {
          const distanceTo = (place: Place) => neighbours.reduce((sum, neighbour) => sum + haversineMeters(neighbour, place), 0);
          return distanceTo(a) - distanceTo(b);
        })[0];
      if (replacement) {
        day.stops[index] = { ...day.stops[index], placeId: replacement.id, durationMinutes: replacement.stayMinutes || day.stops[index].durationMinutes };
        applied.push(`「${current?.name ?? stopPlaceId}」命中避开条件，替换为「${replacement.name}」`);
      } else {
        day.stops.splice(index, 1);
        applied.push(`「${current?.name ?? stopPlaceId}」命中避开条件且无替代，已移除`);
      }
      done = true;
      break;
    }
    if (!done) hintUsed.delete(hint.kind + hint.target);
  }

  // shiftTime: move arrivals into the place's opening window.
  for (const hint of hints.filter((candidate) => candidate.kind === "shiftTime")) {
    const placeId = hint.target;
    for (const day of dayPlans) {
      for (const stop of day.stops) {
        if (stop.placeId !== placeId) continue;
        const place = placeById.get(placeId);
        const ranges = parseOpeningHours(place?.openingHours);
        const open = ranges?.[0];
        if (!open) continue;
        const target = hhmmOf(Math.max(open.start, Math.min(minutesOf(stop.startTime), open.end - (place?.stayMinutes ?? 60))));
        if (target !== stop.startTime) {
          applied.push(`「${place?.name ?? placeId}」到达时间 ${stop.startTime} → ${target}（营业时间 ${hhmmOf(open.start)}-${hhmmOf(open.end)}）`);
          stop.startTime = target;
        }
      }
    }
  }

  // dropStop: cut the most expensive non-must, non-meal stops while the spend
  // floor still exceeds the budget (at most 3 stops per repair pass).
  if (hints.some((hint) => hint.kind === "dropStop")) {
    const mustTerms = ctx.profile?.mustVisit ?? [];
    const isMust = (placeId: string) => {
      const place = placeById.get(placeId);
      return Boolean(place && mustTerms.some((term) => placeMatchesTerm(place, term)));
    };
    const perPerson = ctx.estimatePlaceCost ?? defaultPlaceCost;
    for (let round = 0; round < 3; round += 1) {
      const working: Outline = { ...outline, dayPlans };
      if (outlineSpendFloor(working, { ...ctx, candidates: ctx.candidates }).total <= ctx.budget) break;
      let costliest: { dayIndex: number; stopIndex: number; cost: number; name: string } | undefined;
      dayPlans.forEach((day, dayIndex) => {
        if (day.stops.length <= 1) return;
        day.stops.forEach((stop, stopIndex) => {
          if (stop.meal === "lunch" || stop.meal === "dinner" || isMust(stop.placeId)) return;
          const place = placeById.get(stop.placeId);
          if (!place) return;
          const cost = perPerson(place) * Math.max(1, ctx.travelers);
          if (!costliest || cost > costliest.cost) costliest = { dayIndex, stopIndex, cost, name: place.name };
        });
      });
      if (!costliest) break;
      dayPlans[costliest.dayIndex].stops.splice(costliest.stopIndex, 1);
      applied.push(`为控预算移除「${costliest.name}」（约 ¥${costliest.cost}）`);
    }
  }

  // reorder: greedy nearest-neighbour within days flagged for reachability.
  for (const hint of hints.filter((candidate) => candidate.kind === "reorder")) {
    const dayIndex = Number(hint.target.replace("day:", ""));
    const day = dayPlans[dayIndex];
    if (!day || day.stops.length < 3) continue;
    const first = day.stops[0];
    const remaining = day.stops.slice(1);
    const ordered = [first];
    let cursor = placeById.get(first.placeId);
    while (remaining.length) {
      if (!cursor) break;
      let bestIdx = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((stop, index) => {
        const place = placeById.get(stop.placeId);
        if (!place) return;
        const distance = haversineMeters(cursor!, place);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIdx = index;
        }
      });
      const [next] = remaining.splice(bestIdx, 1);
      ordered.push(next);
      cursor = placeById.get(next.placeId);
    }
    dayPlans[dayIndex] = { ...day, stops: ordered };
    applied.push(`Day ${dayIndex + 1} 按就近原则重排顺序`);
  }

  return { outline: { ...outline, dayPlans }, applied };
}
