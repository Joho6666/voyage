"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { addPlaceItemToDay, TripCommandError } from "@/services/trip-commands";
import { useTripStore } from "@/store/trip-store";
import { formatShortDate } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Adds a place to a day through the real runtime (`add-place-item`), so the
 * change is validated, persisted, and survives a reload. Places without
 * provider provenance are refused server-side; the dialog reports that
 * honestly instead of toasting a fake success.
 */
export function AddToDay({ placeId, label = "＋ 添加" }: { placeId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [busyDayId, setBusyDayId] = useState<string | null>(null);
  const trip = useTripStore((s) => s.trip);
  const revision = useTripStore((s) => s.revision);
  const setTrip = useTripStore((s) => s.setTrip);
  const place = trip.places.find((candidate) => candidate.id === placeId);

  const add = async (dayId: string, dayLabel: string) => {
    if (!place) {
      toast.error("该地点没有可核实的真实数据来源，不能加入行程");
      return;
    }
    setBusyDayId(dayId);
    try {
      const result = await addPlaceItemToDay({ tripId: trip.id, place, dayId, expectedTripRevision: revision });
      setTrip(result.trip, result.revision);
      toast.success(`已加入 ${dayLabel}，刷新后依然保存`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof TripCommandError ? error.message : "加入行程失败，请重试");
    } finally {
      setBusyDayId(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>加入哪一天？</DialogTitle>
          <div className="mt-3 space-y-1.5">
            {trip.days.map((day) => (
              <button
                key={day.id}
                type="button"
                disabled={busyDayId !== null}
                className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
                onClick={() => void add(day.id, `Day ${day.index + 1}`)}
              >
                <span>
                  Day {day.index + 1} · {day.title}
                </span>
                <span className="text-[12px] text-muted-foreground">{formatShortDate(day.date)}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
