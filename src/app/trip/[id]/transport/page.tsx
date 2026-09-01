"use client";

import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";
import { toast } from "sonner";

export default function TransportPage() {
  const trip = useTripStore((s) => s.trip);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">交通</h1>
      <section className="mt-4">
        <h2 className="text-[13px] font-medium text-muted-foreground">大交通</h2>
        <div className="mt-2 space-y-3">
          {trip.transports.map((t) => (
            <article key={t.id} className="rounded-[14px] border border-border p-4">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>{t.fromCity}</span>
                <span className="text-[12px] font-normal text-muted-foreground">{t.kind === "highspeed" ? "高铁" : t.kind}</span>
                <span>{t.toCity}</span>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div>
                  <p className="text-xl font-medium tabular-nums">{t.departTime}</p>
                  <p className="text-[12px] text-muted-foreground">{t.fromStation}</p>
                </div>
                <div className="text-center text-[12px] text-muted-foreground">
                  <div className="mb-1 h-px w-16 bg-border" />
                  {t.durationLabel}
                </div>
                <div className="text-right">
                  <p className="text-xl font-medium tabular-nums">{t.arriveTime}</p>
                  <p className="text-[12px] text-muted-foreground">{t.toStation}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm">{formatCny(t.price)}</span>
                <Button size="sm" variant="outline" onClick={() => toast.message("车次查询为 Demo 数据")}>
                  查看车次
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="mt-6">
        <h2 className="text-[13px] font-medium text-muted-foreground">市内交通</h2>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          渝中半岛以步行为主，跨区用地铁 2 号线 / 环线。行程时间轴里已插入每段交通预估。
        </p>
      </section>
    </div>
  );
}
