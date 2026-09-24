"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hydrateTrip, useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";
import { ExternalLink, Train, Compass, Car, AlertTriangle, Route } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useParams } from "next/navigation";
import { UrbanTransportIntelligence } from "@/components/travel/UrbanTransportIntelligence";
import { reconcileTrainOffers } from "@/services/meituan/transport-fares";

export default function TransportPage() {
  const trip = useTripStore((s) => s.trip);
  const revision = useTripStore((s) => s.revision);
  const { id } = useParams<{ id: string }>();
  const offers = reconcileTrainOffers(trip.offers ?? []).filter((offer) => {
    if (offer.kind !== "train" && offer.kind !== "flight") return false;
    // Hide old unstructured advice paragraphs that were previously persisted
    // as transport offers. They do not contain a schedule or identifiable
    // service and cannot support a price or inventory claim.
    const hasSchedule = Boolean(offer.departureTime || offer.arrivalTime);
    const hasServiceId = /\b(?:[GDCZTK]\d{1,5}|MU\d{2,4}|CZ\d{2,4}|CA\d{2,4}|HU\d{2,4}|9C\d{2,4})\b/i.test(offer.title);
    return offer.structured || hasSchedule || hasServiceId;
  });
  const genericAdviceCount = (trip.offers ?? []).filter((offer) => (offer.kind === "train" || offer.kind === "flight") && !offers.includes(offer)).length;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const refreshTransport = async () => {
    setRefreshing(true); setRefreshMessage("");
    try {
      const response = await fetch("/api/voyage/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "refresh-travel-offers", input: { tripId: trip.id, expectedTripRevision: revision, origin: trip.origin, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, budget: trip.budget, query: `请只返回可核实的${trip.origin}到${trip.destination}高铁/动车和飞机方案；每个方案必须包含车次或航班号、出发时间、到达时间、单人票价、席别和余票/可购状态，并附官方详情链接。不要用预算、区间估算或泛化建议代替票价`, categories: ["train", "flight"] } }) });
      const result = await response.json() as { ok?: boolean; data?: { trip?: typeof trip; revision?: number }; error?: { message?: string } };
      if (!response.ok || !result.ok || !result.data?.trip) throw new Error(result.error?.message ?? "交通数据刷新失败");
      hydrateTrip(result.data.trip, result.data.revision ?? revision + 1);
      setRefreshMessage("已更新交通结果；价格和余票请以供应商页面最终核实为准。");
    } catch (error) { setRefreshMessage(error instanceof Error ? error.message : "交通数据刷新失败"); }
    finally { setRefreshing(false); }
  };

  const handleTrainBooking = (from: string, to: string) => {
    const url = "https://www.12306.cn/index/";
    toast.info(`正在打开 12306 查询：${from} ↔ ${to}`);
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void refreshTransport()} disabled={refreshing}><span className={refreshing ? "animate-pulse" : ""}>{refreshing ? "正在同步车次/航班…" : "同步车次、时间、价格和余票"}</span></Button>
        <Button asChild size="sm" variant="outline"><Link href={`/trip/${encodeURIComponent(id)}/offers`}>打开推荐中心</Link></Button>
      </div>
      {refreshMessage ? <p className="mt-2 text-[11px] text-muted-foreground" role="status">{refreshMessage}</p> : null}

      {/* Inter-city High-Speed Rail Section */}
      <section className="mt-4">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground mb-2">
          <Train className="size-4 text-primary" />
          <span>跨城交通（高铁 / 动车 / 飞机）</span>
        </div>

        {trip.transports.length === 0 && offers.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border p-7 text-center">
            <h2 className="text-sm font-semibold">暂无实时车次或票价</h2>
            <p className="mx-auto mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">{genericAdviceCount > 0 ? `供应商返回了 ${genericAdviceCount} 条泛化交通建议，但没有可核实的车次、航班号或时刻。` : "当前环境没有可用的实时车次/库存数据源。"} 前往推荐中心查询 {trip.origin} 到 {trip.destination}；若供应商未配置或无铁路库存权限，页面会显示具体状态。</p>
            <Button asChild size="sm" className="mt-3"><Link href={`/trip/${encodeURIComponent(id)}/offers`}>查询外部交通</Link></Button>
          </div>
        ) : null}
        <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
          {["高铁 / 动车", "飞机", "市内地铁 / 公交"].map((label) => <div key={label} className="rounded-xl border border-border bg-muted/20 p-2"><p className="font-medium">{label}</p><p className="mt-1 text-muted-foreground">{label === "市内地铁 / 公交" ? "路线可实时对比" : "需供应商返回车次"}</p></div>)}
        </div>
        <div className="space-y-3">
          {offers.map((offer) => (
            <article key={offer.id} className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-xs">
              <div className="flex items-start justify-between gap-3 p-4 pb-3">
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">{offer.provider === "fliggy" ? "飞猪" : offer.provider === "meituan" ? "美团" : "高德"} · {offer.kind === "train" ? "高铁/火车" : "航班"}{offer.structured ? " · 结构化结果" : " · 原文提取"}</p>
                  <h3 className="mt-1 text-sm font-semibold">{offer.title}</h3>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-muted-foreground">{offer.priceLabel ? "参考价格" : "价格"}</p>
                  <strong className="text-lg tabular-nums text-primary">{offer.priceLabel ?? "未知"}</strong>
                  {offer.priceLabel && <p className="text-[10px] text-muted-foreground">以供应商页面为准</p>}
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-y border-border/70 bg-muted/25 px-4 py-3">
                <div><p className="text-xl font-semibold tabular-nums">{offer.departureTime ?? "— —"}</p><p className="text-[10px] text-muted-foreground">{offer.origin ?? trip.origin} · 出发</p></div>
                <div className="min-w-12 text-center"><div className="h-px bg-border" /><p className="mt-1 text-[9px] text-muted-foreground">{offer.departureTime && offer.arrivalTime ? "行程" : "时间待确认"}</p></div>
                <div className="text-right"><p className="text-xl font-semibold tabular-nums">{offer.arrivalTime ?? "— —"}</p><p className="text-[10px] text-muted-foreground">{offer.destination ?? trip.destination} · 到达</p></div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 px-4">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${offer.availability === "available" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : offer.availability === "unavailable" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                    {offer.inventoryLabel ?? (offer.availability === "available" ? "供应商显示可预订" : offer.availability === "unavailable" ? "已售罄" : "余票未知")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">更新于 {new Date(offer.fetchedAt).toLocaleString("zh-CN")}</span>
                </div>
                {offer.bookingUrl ? <Button asChild size="sm"><a href={offer.bookingUrl} target="_blank" rel="noreferrer">核实票价与余票 <ExternalLink className="ml-1 size-3" /></a></Button> : offer.kind === "train" ? <Button size="sm" variant="outline" onClick={() => handleTrainBooking(offer.origin ?? trip.origin, offer.destination ?? trip.destination)}>去 12306 核实 <ExternalLink className="ml-1 size-3" /></Button> : <Button asChild size="sm" variant="outline"><a href="https://flights.ctrip.com/" target="_blank" rel="noreferrer">查询航班 <ExternalLink className="ml-1 size-3" /></a></Button>}
              </div>
              {!offer.structured && <p className="px-4 pb-3 text-[10px] leading-4 text-amber-700 dark:text-amber-300">从服务商文本中提取，字段可能不完整；请点击查询入口核实。没有明确库存信息时不代表有票。</p>}
            </article>
          ))}
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

      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Route className="size-4 text-primary" />
          <span>市内多交通智能对比</span>
        </div>
        <p className="text-[12px] leading-5 text-muted-foreground">
          对每段行程同时比较步行、地铁、公交、打车与驾车，综合时间、费用、步行量、换乘、天气和数据可靠性给出推荐。
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
