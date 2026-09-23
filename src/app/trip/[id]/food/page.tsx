"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { TravelImage } from "@/components/travel/TravelImage";
import { AddToDay } from "@/components/travel/AddToDay";
import { useTripStore } from "@/store/trip-store";
import { Button } from "@/components/ui/button";

const CUISINES = ["火锅", "小面", "江湖菜", "烧烤", "甜品", "夜宵", "咖啡"];

export default function FoodPage() {
  const trip = useTripStore((s) => s.trip);
  const { id } = useParams<{ id: string }>();
  const places = trip.places.filter((place) => place.category === "food" && (place.provenance?.source === "amap" || place.source === "amap"));
  const offers = (trip.offers ?? []).filter((offer) => offer.kind === "restaurant");

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">{trip.destination} 美食</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">{CUISINES.map((c) => <span key={c} className="rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground">{c}</span>)}</div>
      <div className="mt-5 space-y-4">
        {places.map((place) => (
          <article key={place.id} className="overflow-hidden rounded-[14px] border border-border bg-surface">
            {place.image ? <TravelImage src={place.image} alt={place.name} /> : <div className="grid h-28 place-items-center bg-secondary text-sm text-muted-foreground">{place.name} · 高德地点</div>}
            <div className="flex items-start justify-between gap-2 p-3"><div><h2 className="text-sm font-medium">{place.name}</h2><p className="text-xs text-muted-foreground">{place.address} · {place.priceLabel ?? "价格未知"}</p></div><AddToDay placeId={place.id} label="加入行程" /></div>
          </article>
        ))}
        {offers.map((offer) => (
          <article key={offer.id} className="rounded-[14px] border border-border bg-surface p-3">
            {offer.imageUrl ? <TravelImage src={offer.imageUrl} alt={offer.title} className="mb-3 h-32 w-full rounded-lg object-cover" /> : null}
            <div className="flex items-center justify-between gap-2"><div><span className="text-[10px] text-muted-foreground">{offer.provider === "meituan" ? "美团" : offer.provider}</span><h2 className="text-sm font-medium">{offer.title}</h2></div><span className="text-xs">{offer.priceLabel ?? "价格未知"}</span></div>
            {offer.bookingUrl ? <a className="mt-2 inline-block text-xs text-primary underline" href={offer.bookingUrl} target="_blank" rel="noreferrer">查看来源</a> : null}
          </article>
        ))}
        {places.length === 0 && offers.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border p-7 text-center">
            <h2 className="text-sm font-semibold">暂时没有可验证的美食推荐</h2>
            <p className="mx-auto mt-1 max-w-[360px] text-[12px] leading-5 text-muted-foreground">先搜索 {trip.destination} 的高德餐饮 POI，或在推荐中心查询美团结果。</p>
            <div className="mt-3 flex justify-center gap-2"><Button asChild size="sm"><Link href={`/trip/${encodeURIComponent(id)}/explore`}>探索真实 POI</Link></Button><Button asChild size="sm" variant="outline"><Link href={`/trip/${encodeURIComponent(id)}/offers`}>查看外部推荐</Link></Button></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
