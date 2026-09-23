"use client";

import { ExternalLink, Hotel, Plane, Tag, Ticket, TrainFront, Utensils, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import type { OfferKind, TravelOffer } from "@/types/offers";

const groups: Array<{ kind: OfferKind; label: string; icon: typeof Hotel; accent: string }> = [
  { kind: "train", label: "高铁与机票", icon: TrainFront, accent: "text-blue-600 bg-blue-500/10" },
  { kind: "hotel", label: "酒店住宿", icon: Hotel, accent: "text-violet-600 bg-violet-500/10" },
  { kind: "ticket", label: "景点门票", icon: Ticket, accent: "text-amber-600 bg-amber-500/10" },
  { kind: "restaurant", label: "当地美食", icon: Utensils, accent: "text-rose-600 bg-rose-500/10" },
  { kind: "coupon", label: "优惠与券包", icon: Tag, accent: "text-emerald-600 bg-emerald-500/10" },
  { kind: "flight", label: "航班", icon: Plane, accent: "text-sky-600 bg-sky-500/10" },
];

function statusCopy(offer: TravelOffer) {
  if (!offer.structured) return "美团原文推荐";
  if (offer.availability === "available") return "实时结果";
  return "可查询详情";
}

function OfferCard({ offer }: { offer: TravelOffer }) {
  return (
    <article className="rounded-[16px] border border-border bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] font-normal">美团</Badge>
            <span className="text-[10px] text-muted-foreground">{statusCopy(offer)}</span>
          </div>
          <h3 className="line-clamp-3 text-[14px] font-semibold leading-5 text-foreground">{offer.title}</h3>
        </div>
        {offer.priceLabel ? <p className="shrink-0 text-right text-[14px] font-semibold text-foreground">{offer.priceLabel}</p> : null}
      </div>

      {offer.ratingLabel ? <p className="mt-2 text-[12px] text-muted-foreground">评分 {offer.ratingLabel}</p> : null}
      {offer.description && offer.description !== offer.title ? <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{offer.description}</p> : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
        <span className="text-[10px] text-muted-foreground">抓取于 {new Date(offer.fetchedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        {offer.bookingUrl ? (
          <Button asChild size="sm" className="h-8 gap-1.5 text-[11px]">
            <a href={offer.bookingUrl} target="_blank" rel="noreferrer">
              查看详情 <ExternalLink className="size-3" />
            </a>
          </Button>
        ) : <span className="text-[10px] text-muted-foreground">暂无直达链接</span>}
      </div>
    </article>
  );
}

export function OfferHub() {
  const trip = useTripStore((state) => state.trip);
  const offers = trip.offers ?? [];
  const providerStatus = trip.offerProviderStatus?.overall ?? "UNKNOWN";

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin">
      <header className="rounded-[18px] border border-border bg-gradient-to-br from-primary/10 via-surface to-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Travel desk</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">预订推荐</h1>
            <p className="mt-1.5 max-w-[420px] text-[12px] leading-5 text-muted-foreground">把交通、住宿、门票和当地美食集中在一处。结果来自美团实时查询，Voyage 只负责整理与推荐。</p>
          </div>
          <Badge className="shrink-0 bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">{providerStatus === "REAL" ? "实时结果" : providerStatus === "UNSTRUCTURED" ? "原文已保留" : "待查询"}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[12px] bg-background/70 px-2 py-2"><p className="text-lg font-semibold">{offers.length}</p><p className="text-[10px] text-muted-foreground">推荐项</p></div>
          <div className="rounded-[12px] bg-background/70 px-2 py-2"><p className="text-lg font-semibold">{trip.travelers}</p><p className="text-[10px] text-muted-foreground">出行人数</p></div>
          <div className="rounded-[12px] bg-background/70 px-2 py-2"><p className="text-lg font-semibold">¥{trip.budget}</p><p className="text-[10px] text-muted-foreground">预算</p></div>
        </div>
      </header>

      {offers.length === 0 ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-border p-8 text-center">
          <WifiOff className="mx-auto size-6 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">还没有外部预订推荐</h2>
          <p className="mx-auto mt-1 max-w-[300px] text-[12px] leading-5 text-muted-foreground">创建行程时开启外部推荐，或使用 Skill 的 refresh-travel-offers 查询酒店、高铁、门票和美食。</p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {groups.map((group) => {
            const items = offers.filter((offer) => offer.kind === group.kind);
            if (!items.length) return null;
            const Icon = group.icon;
            return (
              <section key={group.kind}>
                <div className="mb-2.5 flex items-center gap-2">
                  <span className={`grid size-7 place-items-center rounded-[9px] ${group.accent}`}><Icon className="size-3.5" /></span>
                  <div><h2 className="text-[13px] font-semibold text-foreground">{group.label}</h2><p className="text-[10px] text-muted-foreground">{items.length} 条推荐</p></div>
                </div>
                <div className="space-y-3">{items.map((offer) => <OfferCard key={offer.id} offer={offer} />)}</div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
