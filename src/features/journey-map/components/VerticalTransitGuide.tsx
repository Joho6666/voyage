"use client";

import React, { useState } from "react";
import type { VerticalInfo } from "@/types/travel";
import { ArrowUpDown, Building2, ChevronDown, ChevronUp, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

export function VerticalTransitGuide({
  vertical,
  compact = false,
  className,
}: {
  vertical: VerticalInfo;
  compact?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!vertical.floor && !vertical.elevationDiffMeters && !vertical.levelDescription) {
    return null;
  }

  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-500/20",
          className,
        )}
        title={vertical.levelDescription || vertical.elevatorHint}
      >
        <ArrowUpDown className="size-3 shrink-0" />
        <span>
          {vertical.floor ? `${vertical.floor}` : "立体交通"}
          {vertical.elevationDiffMeters ? ` (高差${vertical.elevationDiffMeters}m)` : ""}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[10px] border border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-950/30 p-2.5 text-[11px] text-indigo-900 dark:text-indigo-200 transition-all",
        className,
      )}
    >
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 font-medium">
          <div className="grid size-4.5 place-items-center rounded bg-indigo-600 text-white shrink-0">
            <Building2 className="size-3" />
          </div>
          <span className="font-semibold text-indigo-700 dark:text-indigo-300">
            山城立体换乘指引
          </span>
          {vertical.floor ? (
            <span className="rounded bg-indigo-200/70 dark:bg-indigo-900 px-1.5 py-0.2 text-[10px] font-bold">
              {vertical.floor}
            </span>
          ) : null}
          {vertical.elevationDiffMeters ? (
            <span className="text-muted-foreground text-[10px]">
              高差约 {vertical.elevationDiffMeters}m
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={expanded ? "收起立体指引" : "展开立体指引"}
          className="text-indigo-500 hover:text-indigo-700 p-0.5"
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {/* Description */}
      {vertical.levelDescription ? (
        <p className="mt-1 text-muted-foreground leading-relaxed">
          {vertical.levelDescription}
        </p>
      ) : null}

      {/* Expanded Elevator / Stairs / Escalator Hint */}
      {expanded && vertical.elevatorHint ? (
        <div className="mt-2 rounded-[8px] bg-surface/80 p-2 border border-indigo-500/20 animate-in fade-in duration-150">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600">
            <Navigation className="size-3" />
            <span>内部电梯 / 步道换乘路线</span>
          </div>
          <p className="mt-0.5 text-foreground leading-relaxed text-[11px]">
            {vertical.elevatorHint}
          </p>
        </div>
      ) : null}
    </div>
  );
}
