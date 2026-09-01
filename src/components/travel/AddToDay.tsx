"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { travelAgent } from "@/services/ai/mock";
import { useTripStore } from "@/store/trip-store";
import { formatShortDate } from "@/lib/utils";
import { toast } from "sonner";

export function AddToDay({ placeId, label = "＋ 添加" }: { placeId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);

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
                className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm hover:bg-secondary"
                onClick={() => {
                  patch((t) => travelAgent.addItem(t, placeId, day.id));
                  toast.success(`已加入 Day ${day.index + 1}`);
                  setOpen(false);
                }}
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
