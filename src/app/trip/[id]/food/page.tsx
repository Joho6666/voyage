"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { TravelImage } from "@/components/travel/TravelImage";
import { AddToDay } from "@/components/travel/AddToDay";
import { XhsGuidePanel } from "@/components/travel/XhsGuidePanel";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { Button } from "@/components/ui/button";
import { LiveDiscovery } from "@/components/travel/LiveDiscovery";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Place } from "@/types/travel";

const CUISINES = ["全部", "火锅", "小面", "江湖菜", "烧烤", "甜品", "夜宵", "咖啡"];

export default function FoodPage() {
  const trip = useTripStore((s) => s.trip);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const { id } = useParams<{ id: string }>();
  const [cuisine, setCuisine] = useState("全部");
  const places = trip.places.filter(
    (place) => place.category === "food" && (place.provenance?.source === "amap" || place.source === "amap"),
  );
  const offers = (trip.offers ?? []).filter((offer) => offer.kind === "restaurant");

  const locateOnMap = (place: Place) => {
    selectPlace(place.id);
    toast.success(`已在地图定位：${place.name}`);
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{trip.destination} 美食探店</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          真实高德 POI 与小红书爆款探店 · 支持一键在右侧地图高亮或加入当日行程
        </p>
      </div>

      {/* 小红书爆款美食攻略推荐 */}
      <XhsGuidePanel
        city={trip.destination}
        defaultCategory="food"
        title="小红书爆款美食推荐"
        description="精选小红书美食探店与必吃榜笔记，一键解析出真实餐厅并添加到地图或行程。"
      />

      {/* 实时高德美食发现 */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">热门美食分类</h2>
          <span className="text-[11px] text-muted-foreground">高德实时发现</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CUISINES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cuisine === c}
              onClick={() => setCuisine(c)}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                cuisine === c
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <LiveDiscovery
          city={trip.destination}
          kind="food"
          query={cuisine === "全部" ? "特色美食 热门餐厅" : `${cuisine} 餐厅`}
          title={`${trip.destination} · ${cuisine === "全部" ? "本地推荐餐厅" : cuisine}`}
        />
      </div>

      {/* 当前行程已收录的美食 */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">当前行程收录的美食地点（{places.length}）</h2>
        {places.map((place) => (
          <article key={place.id} className="overflow-hidden rounded-[14px] border border-border bg-surface">
            {place.image ? (
              <TravelImage src={place.image} alt={place.name} className="h-36 w-full object-cover" />
            ) : (
              <div className="grid h-24 place-items-center bg-secondary text-xs text-muted-foreground">
                {place.name} · 高德地点
              </div>
            )}
            <div className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium truncate">{place.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {place.address || place.district} · {place.priceLabel ?? "价格未知"}
                </p>
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
            </div>
          </article>
        ))}

        {offers.map((offer) => (
          <article key={offer.id} className="rounded-[14px] border border-border bg-surface p-3">
            {offer.imageUrl ? (
              <TravelImage src={offer.imageUrl} alt={offer.title} className="mb-3 h-32 w-full rounded-lg object-cover" />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] text-muted-foreground">{offer.provider === "meituan" ? "美团" : offer.provider}</span>
                <h3 className="text-sm font-medium">{offer.title}</h3>
              </div>
              <span className="text-xs font-medium">{offer.priceLabel ?? "价格未知"}</span>
            </div>
            {offer.bookingUrl ? (
              <a className="mt-2 inline-block text-xs text-primary underline" href={offer.bookingUrl} target="_blank" rel="noreferrer">
                查看来源
              </a>
            ) : null}
          </article>
        ))}

        {places.length === 0 && offers.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border p-7 text-center">
            <h2 className="text-sm font-semibold">当前行程暂未收录独立美食地点</h2>
            <p className="mx-auto mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">
              可通过上方小红书美食推荐或高德美食发现，将心仪的餐厅一键添加到地图或行程中。
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <Button asChild size="sm">
                <Link href={`/trip/${encodeURIComponent(id)}/explore`}>探索真实 POI</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
