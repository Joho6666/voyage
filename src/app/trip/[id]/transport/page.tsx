"use client";

import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";
import { ExternalLink, Train, Compass, Car, AlertTriangle, Route, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getVerificationEntries,
  TransportCapabilitySummary,
  useProviderCapabilities,
} from "@/components/travel/OfferHub";
import { UrbanTransportIntelligence } from "@/components/travel/UrbanTransportIntelligence";

export default function TransportPage() {
  const trip = useTripStore((s) => s.trip);
  const { id } = useParams<{ id: string }>();
  const { capabilities, loading: capabilitiesLoading, error: capabilitiesError } = useProviderCapabilities();
  const verificationEntries = getVerificationEntries(capabilities, ["train", "flight"]);
  const verificationEntryFor = (kind: "train" | "flight") => verificationEntries.find((entry) => entry.capability === kind);
  const crossCityCount = (trip.offers ?? []).filter((offer) => offer.kind === "train" || offer.kind === "flight").length;

  const openVerificationHomepage = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">交通规划与出行建议</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {trip.origin} → {trip.destination} · Voyage 不持有铁路实时库存；报价、库存与路线请按状态到供应商或官方首页核实
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Cross-city schedules live in the offers hub (single source for every
            provider result); this page keeps planning references and guidance. */}
        <Button asChild size="sm">
          <Link href={`/trip/${encodeURIComponent(id)}/offers`}>
            跨城报价与库存{crossCityCount > 0 ? `（${crossCityCount} 条）` : ""}
            <ArrowRight className="ml-1 size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="mt-4">
        <TransportCapabilitySummary capabilities={capabilities} offerStatus={trip.offerProviderStatus} loading={capabilitiesLoading} error={capabilitiesError} />
      </div>
      {trip.offerProviderStatus?.warnings?.length ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{trip.offerProviderStatus.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div> : null}

      {/* Planning references (from the trip itself, not provider offers) */}
      {trip.transports.length ? (
        <section className="mt-5">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground mb-1">
            <Train className="size-4 text-primary" />
            <span>行程规划参考</span>
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground">以下时间与价格来自行程规划数据，不是供应商报价，也不包含实时库存。</p>
          <div className="space-y-3">
            {trip.transports.map((t) => (
              <article key={t.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-xs">
                <p className="mb-2 text-[10px] text-muted-foreground">行程规划 · 非实时库存或供应商报价</p>
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
                    <span className="text-[11px] text-muted-foreground ml-1">/ 人 · 行程参考价，不是实时报价</span>
                  </div>
                  {t.kind === "highspeed" || t.kind === "flight" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-[12px]"
                      disabled={!verificationEntryFor(t.kind === "flight" ? "flight" : "train")}
                      onClick={() => {
                        const entry = verificationEntryFor(t.kind === "flight" ? "flight" : "train");
                        if (entry) openVerificationHomepage(entry.homepageUrl);
                      }}
                    >
                      <span>{t.kind === "flight" ? "打开航班平台首页" : "打开 12306 官网首页"}</span>
                      <ExternalLink className="size-3" />
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">市内路线请查看下方路线对比</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <ExternalLink className="size-4 text-primary" />
          <span>官方 / 平台首页核实</span>
        </div>
        <p className="text-[12px] leading-5 text-muted-foreground">无法可靠构造带查询条件的深链，因此只打开首页；请手动填写出发地、目的地和日期。入口不代表 Voyage 返回实时库存。</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {verificationEntries.map((entry) => (
            <a key={entry.capability} href={entry.homepageUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-surface p-3 text-xs hover:border-primary/50">
              <span className="font-medium">{entry.actionLabel}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">{entry.message}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Route className="size-4 text-primary" />
          <span>市内多交通智能对比</span>
        </div>
        <p className="text-[12px] leading-5 text-muted-foreground">
          对每段行程同时比较步行、地铁、公交、打车与驾车；高德已配置时使用路线结果，否则仅显示明确标注的估算回退。
        </p>
        <UrbanTransportIntelligence />
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
              3. 避坑与特种兵防耗提醒</h3>
            <p className="text-muted-foreground leading-relaxed mt-1">
              直线距离不等于实际步行距离，山区和大型景区尤其如此。出发前请核对实时导航、开放时间、预约和天气提示。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
