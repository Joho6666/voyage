"use client";

import Link from "next/link";
import { ExternalLink, Building, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { useParams } from "next/navigation";
import { TravelImage } from "@/components/travel/TravelImage";
import { LiveDiscovery } from "@/components/travel/LiveDiscovery";
import { AddToDay } from "@/components/travel/AddToDay";
import { toast } from "sonner";
import type { Place } from "@/types/travel";

export default function HotelsPage() {
  const trip = useTripStore((s) => s.trip);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const { id } = useParams<{ id: string }>();
  const hotelPlaces = trip.places.filter((place) => place.category === "hotel");
  const offers = (trip.offers ?? []).filter((offer) => offer.kind === "hotel");

  const locateOnMap = (place: Place) => {
    selectPlace(place.id);
    toast.success(`已在地图高亮定位：${place.name}`);
  };

  return (
    <div className="h-full max-w-2xl mx-auto overflow-y-auto p-4 pb-24 scrollbar-thin space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">住宿规划与预订建议</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {trip.destination} · 发现心仪酒店可直接加入地图或行程，不生成虚构房价或房态
        </p>
      </div>

      <div className="flex gap-2">
        <Button asChild size="sm">
          <Link href={`/trip/${encodeURIComponent(id)}/offers`}>查询酒店实时房价</Link>
        </Button>
      </div>

      <section className="rounded-[14px] border border-border bg-secondary/40 p-3.5 text-[12px] leading-5">
        <div className="flex items-center gap-1.5 font-medium">
          <Building className="size-4 text-primary" />住宿选址建议
        </div>
        <p className="mt-1 text-muted-foreground">
          优先选择靠近当前行程核心景点、地铁或餐饮街区的区域；通过下方高德实时发现可直接在地图中查看方位并加入行程。
        </p>
      </section>

      {/* 高德实时酒店发现与地图联动 */}
      <LiveDiscovery
        city={trip.destination}
        kind="hotel"
        query="高档酒店 舒适型酒店 精选民宿"
        title={`${trip.destination} · 热门酒店口碑与位置发现`}
      />

      {/* 当前行程收录的住宿 POI */}
      {hotelPlaces.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">当前行程收录的住宿（{hotelPlaces.length}）</h2>
          {hotelPlaces.map((place) => (
            <article key={place.id} className="rounded-[14px] border border-border bg-surface p-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">已在地图</Badge>
                  <h3 className="text-sm font-semibold truncate">{place.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{place.address || place.district}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{place.priceLabel ?? "价格待核实"}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-[11px] gap-1"
                  onClick={() => locateOnMap(place)}
                >
                  <MapPin className="size-3 text-primary" />
                  地图定位
                </Button>
                <AddToDay place={place} label="加入行程" />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {/* 外部供应商 Offers */}
      {offers.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border p-6 text-center">
          <h2 className="text-sm font-semibold">暂时没有来自飞猪/美团的结构化房价结果</h2>
          <p className="mx-auto mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">
            可通过上方高德实时发现将酒店一键标记到地图，或打开外部服务商查实时房态。
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/trip/${encodeURIComponent(id)}/offers`}>打开推荐中心</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="https://hotels.ctrip.com/" target="_blank" rel="noreferrer">
                外部携程查询 <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">供应商实时房态推荐</h2>
          {offers.map((offer) => (
            <article key={offer.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-xs">
              {offer.imageUrl ? (
                <TravelImage src={offer.imageUrl} alt={offer.title} className="mb-3 h-40 w-full rounded-lg object-cover" />
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {offer.provider === "fliggy" ? "飞猪" : offer.provider === "amap" ? "高德" : "美团"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {offer.structured ? "结构化结果" : "原文推荐"}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold">{offer.title}</h3>
                </div>
                {offer.priceLabel ? <p className="shrink-0 text-sm font-semibold">{offer.priceLabel}</p> : null}
              </div>
              {offer.description ? (
                <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{offer.description}</p>
              ) : null}
              <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                <span>{offer.availability === "available" ? "可用性已返回" : "房态需以详情页为准"}</span>
                {offer.bookingUrl ? (
                  <Button asChild size="sm">
                    <a href={offer.bookingUrl} target="_blank" rel="noreferrer">
                      查看官方结果 <ExternalLink className="ml-1 size-3" />
                    </a>
                  </Button>
                ) : (
                  <span>暂无官方链接</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
