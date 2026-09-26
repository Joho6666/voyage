"use client";

import Link from "next/link";
import { ExternalLink, Building } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTripStore } from "@/store/trip-store";
import { useParams } from "next/navigation";
import { TravelImage } from "@/components/travel/TravelImage";
import { LiveDiscovery } from "@/components/travel/LiveDiscovery";

export default function HotelsPage() {
  const trip = useTripStore((s) => s.trip);
  const { id } = useParams<{ id: string }>();
  const offers = (trip.offers ?? []).filter((offer) => offer.kind === "hotel");

  return (
    <div className="h-full max-w-2xl mx-auto overflow-y-auto p-4 pb-24 scrollbar-thin">
      <h1 className="text-xl font-semibold tracking-tight">住宿规划与预订建议</h1>
      <p className="mt-1 text-[12px] text-muted-foreground">{trip.destination} · 只展示可验证的外部结果，不生成虚构房价或房态</p>
      <Button asChild size="sm" className="mt-3"><Link href={`/trip/${encodeURIComponent(id)}/offers`}>查询酒店实时房价</Link></Button>
      <LiveDiscovery city={trip.destination} kind="hotel" query="酒店" title={`${trip.destination} 酒店口碑与位置发现`} />
      <section className="mt-4 rounded-[14px] border border-border bg-secondary/40 p-3.5 text-[12px] leading-5">
        <div className="flex items-center gap-1.5 font-medium"><Building className="size-4 text-primary" />住宿选址原则</div>
        <p className="mt-1 text-muted-foreground">优先选择靠近当前行程 POI、公共交通和餐饮的区域；具体房价、房态和评分以外部服务商实时结果为准。</p>
      </section>
      {offers.length === 0 ? (
        <div className="mt-4 rounded-[14px] border border-dashed border-border p-7 text-center">
          <h2 className="text-sm font-semibold">暂时没有可验证的酒店结果</h2>
          <p className="mx-auto mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">房态和实时价格需要飞猪或美团供应商返回。若刷新后仍无结果，请在推荐中心查看凭据、权限和接口错误状态。</p>
          <Button asChild size="sm" className="mt-3"><Link href={`/trip/${encodeURIComponent(id)}/offers`}>打开推荐中心</Link></Button>
          <Button asChild size="sm" variant="outline" className="mt-2 ml-2"><a href="https://hotels.ctrip.com/" target="_blank" rel="noreferrer">打开外部酒店查询 <ExternalLink className="ml-1 size-3" /></a></Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {offers.map((offer) => (
            <article key={offer.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-xs">
              {offer.imageUrl ? <TravelImage src={offer.imageUrl} alt={offer.title} className="mb-3 h-40 w-full rounded-lg object-cover" /> : null}
              <div className="flex items-start justify-between gap-3"><div><div className="mb-1 flex gap-1.5"><Badge variant="outline" className="text-[10px]">{offer.provider === "fliggy" ? "飞猪" : offer.provider === "amap" ? "高德" : "美团"}</Badge><span className="text-[10px] text-muted-foreground">{offer.structured ? "结构化结果" : "原文推荐"}</span></div><h2 className="text-base font-semibold">{offer.title}</h2></div>{offer.priceLabel ? <p className="shrink-0 text-sm font-semibold">{offer.priceLabel}</p> : null}</div>
              {offer.description ? <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{offer.description}</p> : null}
              <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground"><span>{offer.availability === "available" ? "可用性已返回" : "房态需以详情页为准"}</span>{offer.bookingUrl ? <Button asChild size="sm"><a href={offer.bookingUrl} target="_blank" rel="noreferrer">查看官方结果 <ExternalLink className="ml-1 size-3" /></a></Button> : <span>暂无官方链接</span>}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
