"use client";

import { DAY_COLORS } from "@/types/travel";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

/**
 * In-column day picker. It reads the same store field the map does, so choosing
 * a day here changes the itinerary list and the map together — the two views
 * used to disagree.
 */
export function DayTabs({ className }: { className?: string }) {
  const days = useTripStore((s) => s.trip.days);
  const activeDayId = useUiStore((s) => s.activeDayId);
  const setActiveDay = useUiStore((s) => s.setActiveDay);

  if (days.length <= 1) return null;

  return (
    <div className={cn("scrollbar-thin flex items-center gap-1 overflow-x-auto", className)} role="tablist" aria-label="选择日期">
      <button
        type="button"
        role="tab"
        aria-selected={activeDayId === null}
        onClick={() => setActiveDay(null)}
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
          activeDayId === null ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        全部
      </button>
      {days.map((day) => {
        const selected = activeDayId === day.id;
        return (
          <button
            key={day.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setActiveDay(day.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
              selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: selected ? "#fff" : DAY_COLORS[day.index % DAY_COLORS.length] }} />
            <span>Day {day.index + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
