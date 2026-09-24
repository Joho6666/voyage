import { uid } from "@/lib/utils";
import type { TravelAction } from "./actions/types";
import type { TripChangeSet, ItemChange, TransitChange, TripDiffMetrics } from "@/types/diff";
import type { Trip } from "@/types/travel";

export function computeTripChangeSet(
  beforeTrip: Trip,
  proposedTrip: Trip,
  actions: TravelAction[],
  customSummary?: string,
): TripChangeSet {
  // 1. Compute Walking Metrics
  const beforeWalkSegments = beforeTrip.segments.filter((s) => s.mode === "walk");
  const afterWalkSegments = proposedTrip.segments.filter((s) => s.mode === "walk");

  const walkDistanceBeforeMeters = beforeWalkSegments.reduce(
    (sum, s) => sum + (s.distanceMeters ?? s.meters ?? 0),
    0,
  );
  const walkDistanceAfterMeters = afterWalkSegments.reduce(
    (sum, s) => sum + (s.distanceMeters ?? s.meters ?? 0),
    0,
  );
  const walkDistanceDiffMeters = walkDistanceAfterMeters - walkDistanceBeforeMeters;

  const walkDurationBeforeMinutes = beforeWalkSegments.reduce(
    (sum, s) => sum + (s.durationMinutes ?? s.minutes ?? 0),
    0,
  );
  const walkDurationAfterMinutes = afterWalkSegments.reduce(
    (sum, s) => sum + (s.durationMinutes ?? s.minutes ?? 0),
    0,
  );
  const walkDurationSavedMinutes = Math.max(0, walkDurationBeforeMinutes - walkDurationAfterMinutes);

  // 2. Compute Costs & Transit Changes
  const beforeCost = beforeTrip.estimatedSpend ?? 0;
  let afterCost = proposedTrip.estimatedSpend ?? 0;

  // Track transit mode shifts
  const transitChanges: TransitChange[] = [];
  const beforePlaceMap = new Map(beforeTrip.places.map((p) => [p.id, p.name]));
  const afterPlaceMap = new Map(proposedTrip.places.map((p) => [p.id, p.name]));

  // Compare segments between common items
  proposedTrip.segments.forEach((afterSeg) => {
    const matchingBefore = beforeTrip.segments.find(
      (bs) =>
        (bs.fromItemId === afterSeg.fromItemId && bs.toItemId === afterSeg.toItemId) ||
        (bs.fromPlaceId && bs.fromPlaceId === afterSeg.fromPlaceId && bs.toPlaceId === afterSeg.toPlaceId),
    );
    if (matchingBefore && matchingBefore.mode !== afterSeg.mode) {
      const fromName = beforePlaceMap.get(matchingBefore.fromPlaceId) ?? afterPlaceMap.get(afterSeg.fromPlaceId) ?? "起点";
      const toName = afterPlaceMap.get(afterSeg.toPlaceId) ?? "下一站";
      const modeNames: Record<string, string> = {
        walk: "步行",
        metro: "地铁",
        taxi: "出租/网约车",
        bus: "公交",
        drive: "自驾",
      };
      const oldLabel = modeNames[matchingBefore.mode] ?? matchingBefore.mode;
      const newLabel = modeNames[afterSeg.mode] ?? afterSeg.mode;
      transitChanges.push({
        fromPlaceName: fromName,
        toPlaceName: toName,
        oldMode: oldLabel,
        newMode: newLabel,
        detail: `从 ${fromName} 到 ${toName}：${oldLabel} → ${newLabel}`,
      });

      // If switched to taxi, reflect approximate fare difference
      if (matchingBefore.mode === "walk" && (afterSeg.mode === "taxi" || afterSeg.mode === "drive")) {
        afterCost += 15;
      } else if (matchingBefore.mode === "metro" && (afterSeg.mode === "taxi" || afterSeg.mode === "drive")) {
        afterCost += 12;
      } else if ((matchingBefore.mode === "taxi" || matchingBefore.mode === "drive") && afterSeg.mode === "metro") {
        afterCost = Math.max(0, afterCost - 12);
      }
    }
  });

  const costDiff = afterCost - beforeCost;

  const metrics: TripDiffMetrics = {
    walkDistanceBeforeMeters,
    walkDistanceAfterMeters,
    walkDistanceDiffMeters,
    walkDurationBeforeMinutes,
    walkDurationAfterMinutes,
    walkDurationSavedMinutes,
    estimatedCostBefore: beforeCost,
    estimatedCostAfter: afterCost,
    costDiff,
    transitChanges,
  };

  // 3. Compare Items
  const itemChanges: ItemChange[] = [];
  const beforeItemMap = new Map(beforeTrip.items.map((i) => [i.id, i]));
  const afterItemMap = new Map(proposedTrip.items.map((i) => [i.id, i]));

  // Removed items
  beforeTrip.items.forEach((item) => {
    if (!afterItemMap.has(item.id)) {
      const place = beforeTrip.places.find((p) => p.id === item.placeId);
      itemChanges.push({
        type: "removed",
        itemId: item.id,
        placeName: place?.name ?? "未知地点",
        detail: `已移除：${place?.name ?? "行程项"}`,
      });
    }
  });

  // Added items
  proposedTrip.items.forEach((item) => {
    if (!beforeItemMap.has(item.id)) {
      const place = proposedTrip.places.find((p) => p.id === item.placeId);
      itemChanges.push({
        type: "added",
        itemId: item.id,
        placeName: place?.name ?? "新增地点",
        detail: `已新增：${place?.name ?? "新景点"} (${item.startTime}，停留 ${item.duration}分钟)`,
      });
    }
  });

  // Modified items
  proposedTrip.items.forEach((afterItem) => {
    const beforeItem = beforeItemMap.get(afterItem.id);
    if (!beforeItem) return;
    const afterPlace = proposedTrip.places.find((p) => p.id === afterItem.placeId);
    const beforePlace = beforeTrip.places.find((p) => p.id === beforeItem.placeId);

    if (beforeItem.placeId !== afterItem.placeId) {
      itemChanges.push({
        type: "replaced",
        itemId: afterItem.id,
        placeName: afterPlace?.name ?? "替代地点",
        detail: `将 ${beforePlace?.name ?? "原地点"} 替换为 ${afterPlace?.name ?? "新地点"}`,
      });
    } else if (beforeItem.startTime !== afterItem.startTime) {
      itemChanges.push({
        type: "time_shifted",
        itemId: afterItem.id,
        placeName: afterPlace?.name ?? "地点",
        detail: `${afterPlace?.name ?? "行程"} 时间调整：${beforeItem.startTime} → ${afterItem.startTime}`,
      });
    } else if (beforeItem.duration !== afterItem.duration) {
      itemChanges.push({
        type: "stay_changed",
        itemId: afterItem.id,
        placeName: afterPlace?.name ?? "地点",
        detail: `${afterPlace?.name ?? "行程"} 停留时间调整为 ${afterItem.duration} 分钟`,
      });
    } else if (beforeItem.order !== afterItem.order) {
      itemChanges.push({
        type: "reordered",
        itemId: afterItem.id,
        placeName: afterPlace?.name ?? "地点",
        detail: `${afterPlace?.name ?? "地点"} 顺序调整`,
      });
    }
  });

  // Generate clear summary
  let summary = customSummary || "行程优化提案";
  if (!customSummary) {
    const parts: string[] = [];
    if (walkDistanceDiffMeters < -300) {
      parts.push(`减少步行 ${(Math.abs(walkDistanceDiffMeters) / 1000).toFixed(1)} km`);
    }
    if (walkDurationSavedMinutes > 15) {
      parts.push(`节省 ${walkDurationSavedMinutes} 分钟`);
    }
    if (transitChanges.length > 0) {
      parts.push(`${transitChanges.length} 段交通优化`);
    }
    if (itemChanges.length > 0) {
      parts.push(`${itemChanges.length} 项行程调整`);
    }
    if (parts.length > 0) {
      summary = parts.join(" · ");
    }
  }

  return {
    id: uid("diff"),
    summary,
    metrics,
    itemChanges,
    actions,
    beforeTrip,
    proposedTrip,
  };
}
