import type { OptimizerAssignment, OptimizerInput, PlaceScheduleProfile } from "./types";
import { isRainy } from "./time-windows";

/**
 * Post-schedule checks. The optimizer never fabricates data, so unknown
 * opening hours and unknown weather surface as unresolved constraints
 * instead of being silently ignored or invented.
 */
export function validateAssignments(
  assignments: OptimizerAssignment[],
  scheduled: PlaceScheduleProfile[],
  input: OptimizerInput,
): { warnings: string[]; unresolvedConstraints: string[] } {
  const warnings: string[] = [];
  const unresolvedConstraints: string[] = [];
  const profile = input.profile;
  const names = scheduled.map((member) => member.place.name);

  if (profile?.avoid?.length) {
    const leaked = scheduled.filter((member) => profile.avoid.some((term) => member.place.name.includes(term.trim())));
    if (leaked.length) {
      warnings.push(`avoid 名单中的地点未被完全排除：${leaked.map((member) => member.place.name).join("、")}`);
    }
  }
  if (profile?.mustVisit?.length) {
    const missing = profile.mustVisit.filter((term) => !names.some((name) => name.includes(term.trim())));
    if (missing.length && scheduled.length) {
      warnings.push(`mustVisit 未能全部满足：${missing.join("、")}（候选中可能不存在这些地点）`);
    }
  }
  const seen = new Map<string, number>();
  assignments.forEach((assignment) => {
    for (const place of assignment.places) {
      seen.set(place.id, (seen.get(place.id) ?? 0) + 1);
    }
  });
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1);
  if (duplicated.length) {
    warnings.push(`同一地点被安排到多天（已去重处理）：${duplicated.map(([id]) => id).join("、")}`);
  }
  assignments.forEach((assignment, index) => {
    if (!assignment.places.length) {
      warnings.push(`Day ${index + 1} 未安排任何地点（候选数量不足或被约束过滤）`);
    }
  });

  if (scheduled.length) {
    unresolvedConstraints.push(
      `全部 ${scheduled.length} 个地点的营业时间为 unknown：排程未使用营业时间约束，也未伪造任何营业信息（等待真实 opening-hours Provider）`,
    );
  }
  input.days.forEach((day, index) => {
    if (!isRainy(day.weather) && !day.weather?.condition) {
      unresolvedConstraints.push(`Day ${index + 1} 天气未知（无预报数据），未按天气调整当天安排`);
    }
  });
  return { warnings, unresolvedConstraints };
}
