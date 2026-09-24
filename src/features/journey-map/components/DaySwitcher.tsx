"use client";

import React from "react";
import { DAY_COLORS, type Day } from "@/types/travel";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

export function DaySwitcher({
  days,
  activeDayId,
  onSelectDay,
  onOpenOverview,
}: {
  days: Day[];
  activeDayId: string | null;
  onSelectDay: (dayId: string | null) => void;
  onOpenOverview?: () => void;
}) {
  return (
    <div className="absolute left-3.5 top-3.5 z-20 flex max-w-[calc(100%-80px)] flex-wrap items-center gap-1 select-none">
      <div className="flex items-center gap-1 rounded-full border border-border/80 bg-surface/90 p-1 shadow-sm backdrop-blur-xs">
        {/* All Days option */}
        <button
          type="button"
          onClick={() => onSelectDay(null)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors shrink-0",
            activeDayId === null
              ? "bg-primary text-white shadow-xs"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          全部
        </button>

        {/* Each Day option */}
        {days.map((day) => {
          const isSelected = activeDayId === day.id;
          const color = DAY_COLORS[day.index % DAY_COLORS.length];
          return (
            <button
              key={day.id}
              type="button"
              onClick={() => onSelectDay(day.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors shrink-0",
                isSelected
                  ? "bg-primary text-white shadow-xs"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ background: isSelected ? "#fff" : color }}
              />
              <span>Day {day.index + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Journey Overview Trigger */}
      {onOpenOverview ? (
        <button
          type="button"
          onClick={onOpenOverview}
          className="flex items-center gap-1 rounded-full border border-border/80 bg-surface/90 px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-sm backdrop-blur-xs transition-colors hover:bg-secondary shrink-0"
        >
          <Sparkles className="size-3.5 text-amber-500" />
          <span>行程总览</span>
        </button>
      ) : null}
    </div>
  );
}
