"use client";

import { Check, Footprints, Sparkles, TrendingDown, TrendingUp, Undo2, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TripChangeSet } from "@/types/diff";
import { formatKm } from "@/lib/utils";

interface TripDiffModalProps {
  changeSet: TripChangeSet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (changeSet: TripChangeSet) => void;
  onCancel?: () => void;
}

export function TripDiffModal({
  changeSet,
  open,
  onOpenChange,
  onApply,
  onCancel,
}: TripDiffModalProps) {
  if (!changeSet) return null;

  const { metrics, itemChanges, summary } = changeSet;
  const walkDiffKm = metrics.walkDistanceDiffMeters / 1000;
  const isWalkReduced = metrics.walkDistanceDiffMeters < -100;
  const isCostIncreased = metrics.costDiff > 0;
  const isCostReduced = metrics.costDiff < 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,520px)] max-h-[85vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div className="p-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2 text-primary text-[12px] font-medium">
            <Sparkles className="size-3.5" />
            <span>AI 行程优化建议</span>
          </div>
          <DialogTitle className="mt-1 text-lg font-medium text-foreground">
            {summary}
          </DialogTitle>
          <p className="mt-1 text-[13px] text-muted-foreground">
            以下为本次调整的量化指标对比与行程变更细节，确认后将自动更新行程并保存。
          </p>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {/* Walking Metric */}
            <div className="rounded-[12px] border border-border/80 bg-secondary/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Footprints className="size-3" />
                  步行距离
                </span>
                {isWalkReduced ? (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                    {walkDiffKm.toFixed(1)} km
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5 text-sm font-medium">
                <span className="text-muted-foreground line-through text-[12px]">
                  {formatKm(metrics.walkDistanceBeforeMeters)}
                </span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <span className={isWalkReduced ? "text-emerald-600 font-semibold" : "text-foreground"}>
                  {formatKm(metrics.walkDistanceAfterMeters)}
                </span>
              </div>
              {metrics.walkDurationSavedMinutes > 5 ? (
                <p className="mt-1 text-[11px] text-emerald-600">
                  节省约 {metrics.walkDurationSavedMinutes} 分钟步行
                </p>
              ) : null}
            </div>

            {/* Cost Metric */}
            <div className="rounded-[12px] border border-border/80 bg-secondary/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">预估费用</span>
                {isCostReduced ? (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                    <TrendingDown className="size-2.5" />
                    省 ¥{Math.abs(metrics.costDiff)}
                  </span>
                ) : isCostIncreased ? (
                  <span className="text-[10px] font-medium text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                    <TrendingUp className="size-2.5" />
                    +¥{metrics.costDiff}
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5 text-sm font-medium">
                <span className="text-muted-foreground text-[12px]">
                  ¥{metrics.estimatedCostBefore}
                </span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <span className="text-foreground">
                  ¥{metrics.estimatedCostAfter}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isCostIncreased ? "打车替换所增加费用" : isCostReduced ? "优化公共交通结余" : "预算保持持平"}
              </p>
            </div>

            {/* Transit Shifts */}
            <div className="col-span-2 sm:col-span-1 rounded-[12px] border border-border/80 bg-secondary/50 p-3">
              <span className="text-[11px] text-muted-foreground">交通调整</span>
              <p className="mt-1.5 text-sm font-medium text-foreground">
                {metrics.transitChanges.length > 0 ? `${metrics.transitChanges.length} 段交通置换` : "保持原交通"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                {metrics.transitChanges[0]?.detail ?? "路线时间已同步重算"}
              </p>
            </div>
          </div>

          {/* Transit Changes List if any */}
          {metrics.transitChanges.length > 0 ? (
            <div className="rounded-[12px] border border-border bg-surface p-3 space-y-1.5">
              <p className="text-[12px] font-medium text-foreground">交通方式优化：</p>
              <ul className="space-y-1 text-[12px] text-muted-foreground">
                {metrics.transitChanges.map((tc, idx) => (
                  <li key={idx} className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" />
                    <span>{tc.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Detailed Item Changes */}
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-foreground">行程节点调整明细：</p>
            <div className="space-y-1.5">
              {itemChanges.length > 0 ? (
                itemChanges.map((change, index) => {
                  const badgeColor =
                    change.type === "added"
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : change.type === "removed"
                        ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                        : change.type === "replaced"
                          ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                          : "bg-secondary text-muted-foreground border-border";
                  const badgeLabel =
                    change.type === "added"
                      ? "新增"
                      : change.type === "removed"
                        ? "移除"
                        : change.type === "replaced"
                          ? "替换"
                          : change.type === "time_shifted"
                            ? "时间"
                            : change.type === "stay_changed"
                              ? "时长"
                              : "顺序";

                  return (
                    <div
                      key={index}
                      className="flex items-start gap-2.5 rounded-[10px] border border-border/70 bg-surface px-3 py-2 text-[12px]"
                    >
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border ${badgeColor}`}>
                        {badgeLabel}
                      </span>
                      <span className="flex-1 text-foreground leading-relaxed">
                        {change.detail}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-[10px] border border-border/70 bg-surface px-3 py-2 text-[12px] text-muted-foreground">
                  路线经过重新聚类，减少重复折返路程。
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-3 bg-secondary/30">
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Undo2 className="size-3" />
            应用后支持随时一键撤销
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onCancel?.();
              }}
            >
              放弃修改
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApply(changeSet);
                onOpenChange(false);
              }}
            >
              <Check className="size-3.5" />
              应用此修改
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
