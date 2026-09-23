"use client";

import { useState } from "react";
import { ExternalLink, Hotel, Plane, Tag, Ticket, TrainFront, Utensils, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTripStore } from "@/store/trip-store";
import type { OfferKind, TravelOffer } from "@/types/offers";
import { TravelImage } from "@/components/travel/TravelImage";

const groups: Array<{ kind: OfferKind; label: string; icon: typeof Hotel }> = [
  { kind: "hotel", label: "酒店", icon: Hotel }, { kind: "train", label: "高铁", icon: TrainFront },
  { kind: "flight", label: "机票", icon: Plane }, { kind: "ticket", label: "门票", icon: Ticket },
  { kind: "restaurant", label: "美食", icon: Utensils }, { kind: "coupon", label: "优惠", icon: Tag },
];

function OfferCard({ offer }: { offer: TravelOffer }) {
  return (
    <article className="rounded-[16px] border border-border bg-surface p-4 shadow-xs">
      {offer.imageUrl ? <TravelImage src={offer.imageUrl} alt={offer.title} className="mb-3 h-40 w-full rounded-lg object-cover" /> : null}
      <div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{offer.provider === "fliggy" ? "飞猪" : offer.provider === "amap" ? "高德" : "美团"}</Badge><span className="text-[10px] text-muted-foreground">{offer.structured ? "结构化结果" : "原文推荐"}</span></div><h3 className="text-[14px] font-semibold">{offer.title}</h3></div>{offer.priceLabel ? <span className="shrink-0 text-sm font-semibold">{offer.priceLabel}</span> : null}</div>
      {offer.description ? <p className="mt-2 text-[12px] text-muted-foreground">{offer.description}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{offer.inventoryLabel ?? (offer.availability === "available" ? "可售状态已返回" : "库存未知")}</span><span>来源 ID：{offer.sourceId ?? "未提供"}</span><span>查询于 {new Date(offer.fetchedAt).toLocaleString("zh-CN")}</span></div>
      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3"><span className="text-[10px] text-muted-foreground">价格和库存可能变化，请以供应商页面为准</span>{offer.bookingUrl ? <Button asChild size="sm"><a href={offer.bookingUrl} target="_blank" rel="noreferrer">查看来源 <ExternalLink className="ml-1 size-3" /></a></Button> : <span className="text-[10px] text-muted-foreground">暂无直达链接</span>}</div>
    </article>
  );
}

export function OfferHub() {
  const trip = useTripStore((state) => state.trip);
  const revision = useTripStore((state) => state.revision);
  const setTrip = useTripStore((state) => state.setTrip);
  const [origin, setOrigin] = useState(trip.origin);
  const [destination, setDestination] = useState(trip.destination);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [travelers, setTravelers] = useState(trip.travelers);
  const [budget, setBudget] = useState(trip.budget);
  const [categories, setCategories] = useState<OfferKind[]>(groups.map((group) => group.kind));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const offers = trip.offers ?? [];
  const status = trip.offerProviderStatus;

  const refresh = async () => {
    if (!categories.length) { setError("请至少选择一个查询类别"); return; }
    setError(""); setLoading(true);
    try {
      const response = await fetch("/api/voyage/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "refresh-travel-offers", input: { tripId: trip.id, expectedTripRevision: revision, origin, destination, startDate, endDate, travelers, budget, query: "查询酒店、高铁、机票、景点门票、美食和优惠", categories } }) });
      const result = await response.json() as { ok?: boolean; data?: { trip?: typeof trip; revision?: number }; error?: { code?: string; message?: string } };
      if (!result.ok || !result.data?.trip) throw new Error(result.error?.code === "REVISION_CONFLICT" ? "行程已在其他页面更新，请刷新页面后重试" : result.error?.message ?? "刷新失败");
      setTrip(result.data.trip, result.data.revision);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "刷新失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin">
      <header className="rounded-[18px] border border-border bg-gradient-to-br from-primary/10 via-surface to-surface p-5"><h1 className="text-xl font-semibold">外部实时数据中心</h1><p className="mt-1 text-[12px] text-muted-foreground">查询酒店、交通、门票、美食、优惠及天气；结果按供应商来源展示。</p></header>
      <section className="mt-4 rounded-[16px] border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs">出发地<Input value={origin} onChange={(event) => setOrigin(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">目的地<Input value={destination} onChange={(event) => setDestination(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">开始日期<Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">结束日期<Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">人数<Input type="number" min={1} max={20} value={travelers} onChange={(event) => setTravelers(Number(event.target.value))} className="mt-1" /></label>
          <label className="text-xs">预算（元）<Input type="number" min={0} value={budget} onChange={(event) => setBudget(Number(event.target.value))} className="mt-1" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{groups.map((group) => <label key={group.kind} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={categories.includes(group.kind)} onChange={() => setCategories((current) => current.includes(group.kind) ? current.filter((item) => item !== group.kind) : [...current, group.kind])} />{group.label}</label>)}</div>
        <Button className="mt-4" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />{loading ? "正在查询供应商…" : "刷新全部"}</Button>
        {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
      </section>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[...groups.map((group) => ({ key: group.kind, label: group.label })), { key: "weather", label: "天气" }].map(({ key, label }) => <div key={key} className="rounded-xl border border-border p-3 text-xs"><strong>{label}</strong><p className="mt-1 text-muted-foreground">{status?.[key as OfferKind | "weather"] ?? "UNKNOWN"}</p></div>)}</div>
      {status?.warnings?.length ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{status.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div> : null}
      {offers.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">暂无可验证的外部结果。点击“刷新全部”查询。</p> : null}
      <div className="mt-5 space-y-6">{groups.map((group) => { const items = offers.filter((offer) => offer.kind === group.kind); if (!items.length) return null; const Icon = group.icon; return <section key={group.kind}><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" />{group.label} · {items.length}</h2><div className="space-y-3">{items.map((offer) => <OfferCard key={offer.id} offer={offer} />)}</div></section>; })}</div>
    </div>
  );
}
