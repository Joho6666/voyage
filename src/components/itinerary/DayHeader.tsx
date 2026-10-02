"use client";

import { formatKm, formatShortDate, weekdayZh } from "@/lib/utils";
import { dayStats } from "@/services/routing";
import { removeDayFromTrip, TripCommandError } from "@/services/trip-commands";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useHistoryStore } from "@/store/history-store";
import { resyncTrip, useTripStore } from "@/store/trip-store";
import type { Day, Trip } from "@/types/travel";
import { DAY_COLORS } from "@/types/travel";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function DayHeader({ trip, day }: { trip: Trip; day: Day }) {
  const pushHistory = useHistoryStore((s) => s.push);
  const stats = dayStats(trip, day.id);
  const color = DAY_COLORS[day.index % DAY_COLORS.length];

  const removeDay = () => {
    if (trip.days.length <= 1) {
      toast.error("至少要保留一天行程");
      return;
    }
    if (!window.confirm(`确定删除 Day ${day.index + 1}（${day.date}）的全部安排吗？删除后可以在「今天」页撤销。`)) return;
    const snapshot = useTripStore.getState().trip;
    const snapshotRevision = useTripStore.getState().revision;
    pushHistory(snapshot);
    void removeDayFromTrip({ tripId: snapshot.id, dayId: day.id, expectedTripRevision: snapshotRevision })
      .then(({ trip: saved, revision }) => {
        useTripStore.getState().setTrip(saved, revision);
        toast.success(`已删除 Day ${day.index + 1}，可在「今天」页撤销`);
      })
      .catch((cause) => {
        useTripStore.getState().setTrip(snapshot, snapshotRevision);
        if (cause instanceof TripCommandError && cause.code === "REVISION_CONFLICT") {
          toast.error("行程已在别处更新，已同步最新版本，请重试");
          void resyncTrip(snapshot.id);
          return;
        }
        toast.error(cause instanceof TripCommandError ? cause.message : "删除失败，请重试");
      });
  };

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: color }} />
        <h2 className="text-[15px] font-medium">Day {day.index + 1}</h2>
        <span className="text-[13px] text-muted-foreground">
          {formatShortDate(day.date)} · {weekdayZh(day.date)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-auto rounded-[8px] p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="这一天更多操作"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={removeDay} className="text-rose-600 focus:text-rose-700">
              <Trash2 className="mr-2 size-3.5" />
              删除这一天
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {stats.places} 个地点 · {formatKm(stats.meters)}
        {stats.walkMin ? ` · 步行 ${stats.walkMin} min` : ""}
        {stats.metroMin ? ` · 地铁 ${stats.metroMin} min` : ""}
      </p>
    </div>
  );
}
