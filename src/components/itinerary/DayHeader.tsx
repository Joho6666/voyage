import { formatKm, formatShortDate, weekdayZh } from "@/lib/utils";
import { dayStats } from "@/services/routing";
import type { Day, Trip } from "@/types/travel";
import { DAY_COLORS } from "@/types/travel";

export function DayHeader({ trip, day }: { trip: Trip; day: Day }) {
  const stats = dayStats(trip, day.id);
  const color = DAY_COLORS[day.index % DAY_COLORS.length];

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: color }} />
        <h2 className="text-[15px] font-medium">Day {day.index + 1}</h2>
        <span className="text-[13px] text-muted-foreground">
          {formatShortDate(day.date)} · {weekdayZh(day.date)}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {stats.places} 个地点 · {formatKm(stats.meters)}
        {stats.walkMin ? ` · 步行 ${stats.walkMin} min` : ""}
        {stats.metroMin ? ` · 地铁 ${stats.metroMin} min` : ""}
      </p>
    </div>
  );
}
