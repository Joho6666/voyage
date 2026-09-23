"use client";

import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";
import { ExternalLink, Train, Compass, Car, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export default function TransportPage() {
  const trip = useTripStore((s) => s.trip);

  const handleTrainBooking = (from: string, to: string) => {
    const url = `https://trains.ctrip.com/trainbooking/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    toast.info(`正在打开携程高铁预订：${from} ↔ ${to}`);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">交通规划与出行建议</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {trip.origin} → {trip.destination} · 车次与票价以外部服务商实时结果为准
        </p>
      </div>

      {/* Inter-city High-Speed Rail Section */}
      <section className="mt-4">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground mb-2">
          <Train className="size-4 text-primary" />
          <span>城市间大交通（高铁往返）</span>
        </div>

        {trip.transports.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border p-7 text-center">
            <h2 className="text-sm font-semibold">暂无实时车次或票价</h2>
            <p className="mx-auto mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">当前页面不会展示虚构车次、余票或价格。请开启美团外部推荐，或使用推荐中心查询 {trip.origin} 到 {trip.destination} 的交通。</p>
            <Button asChild size="sm" className="mt-3"><Link href="../offers">查询外部交通</Link></Button>
          </div>
        ) : null}
        <div className="space-y-3">
          {trip.transports.map((t) => (
            <article key={t.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-xs">
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="text-base">{t.fromCity}</span>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                  {t.kind === "highspeed" ? "动车/高铁 G/D" : t.kind}
                </span>
                <span className="text-base">{t.toCity}</span>
              </div>

              <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div>
                  <p className="text-xl font-semibold tabular-nums text-foreground">{t.departTime}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{t.fromStation}</p>
                </div>
                <div className="text-center text-[11px] text-muted-foreground">
                  <div className="mb-1 h-px w-20 bg-border mx-auto" />
                  {t.durationLabel}
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold tabular-nums text-foreground">{t.arriveTime}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{t.toStation}</p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border/70 flex items-center justify-between">
                <div>
                  <span className="text-base font-semibold text-foreground">{formatCny(t.price)}</span>
                  <span className="text-[11px] text-muted-foreground ml-1">/ 人 (二等座基准)</span>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 text-[12px]"
                  onClick={() => handleTrainBooking(t.fromCity, t.toCity)}
                >
                  <span>预订车票</span>
                  <ExternalLink className="size-3" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Intra-city Urban Transit Guidelines */}
      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Compass className="size-4 text-primary" />
          <span>山城特色市内出行指南</span>
        </div>

        <div className="rounded-[14px] border border-border bg-surface p-4 space-y-3 text-[12px]">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-1.5">
              <Train className="size-3.5 text-primary" />
              1. 轨道交通（最推荐）
            </h3>
            <p className="text-muted-foreground leading-relaxed mt-1">
              优先查看 {trip.destination} 的官方轨道交通和公交线路；具体站点、运营时间和票价以当地交通服务为准。
            </p>
          </div>

          <div className="pt-2 border-t border-border/60">
            <h3 className="font-semibold text-foreground flex items-center gap-1.5">
              <Car className="size-3.5 text-primary" />
              2. 出租车与网约车（爬坡与夜间补充）
            </h3>
            <p className="text-muted-foreground leading-relaxed mt-1">
              对跨片区、夜间或携带行李的路段，优先使用高德路线结果或官方打车服务。系统只会在路线提供方返回后展示预计时间，不虚构固定起步价。
            </p>
          </div>

          <div className="pt-2 border-t border-border/60">
            <h3 className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              3. 避坑与特种兵防耗提醒
            </h3>
            <p className="text-muted-foreground leading-relaxed mt-1">
              直线距离不等于实际步行距离，山区和大型景区尤其如此。出发前请核对实时导航、开放时间、预约和天气提示。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
