"use client";

import { useState } from "react";
import { TravelImage } from "@/components/travel/TravelImage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";
import type { BookingOption } from "@/types/booking";
import { ExternalLink, Building, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function HotelsPage() {
  const trip = useTripStore((s) => s.trip);
  const [selectedProvider, setSelectedProvider] = useState<"trip" | "booking" | "amap">("trip");

  const buildOptions = (hotelName: string): BookingOption[] => {
    return [
      {
        id: `opt-trip-${hotelName}`,
        provider: "trip",
        providerName: "携程旅行 (Trip.com)",
        title: "携程官方预订",
        category: "hotel",
        currency: "CNY",
        deepLink: `https://www.trip.com/hotels/list?city=${encodeURIComponent(trip.destination)}&keywords=${encodeURIComponent(hotelName)}`,
        badge: "推荐渠道",
      },
      {
        id: `opt-amap-${hotelName}`,
        provider: "amap",
        providerName: "高德地图找房",
        title: "高德位置与比价",
        category: "hotel",
        currency: "CNY",
        deepLink: `https://uri.amap.com/search?keyword=${encodeURIComponent(hotelName)}&city=${encodeURIComponent(trip.destination)}`,
        badge: "查距离",
      },
      {
        id: `opt-booking-${hotelName}`,
        provider: "booking",
        providerName: "Booking.com",
        title: "缤客国际预订",
        category: "hotel",
        currency: "CNY",
        deepLink: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName + " " + trip.destination)}`,
      },
    ];
  };

  const handleRedirect = (hotelName: string, option: BookingOption) => {
    toast.info(`正在前往 ${option.providerName} 查看 ${hotelName} 实时房态...`);
    window.open(option.deepLink, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">住宿规划与预订建议</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          基于行程核心商圈推荐 · Voyage 仅作为 Booking Intent 决策支持，点击直达外部服务商
        </p>
      </div>

      {/* Recommended Area Insight Banner */}
      <section className="mt-4 rounded-[14px] border border-border bg-secondary/40 p-3.5 text-[12px] space-y-1.5">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Building className="size-4 text-primary" />
          <span>推荐住宿区域：解放碑 / 较场口核心商圈</span>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          <strong>为什么推荐住这里：</strong>重庆地形立体复杂，解放碑商圈紧邻地铁 1 号线与 2 号线交汇站（较场口），步行 10-15 分钟可达洪崖洞、山城巷与八一路好吃街。第一晚看夜景与吃火锅无需打车，能为 Day 2/Day 3 节省大量爬坡与折返开销。
        </p>
      </section>

      {/* Hotel Cards List */}
      <div className="mt-4 space-y-4">
        {trip.hotels.map((hotel) => {
          const options = buildOptions(hotel.name);
          const activeOption = options.find((o) => o.provider === selectedProvider) ?? options[0]!;

          return (
            <article key={hotel.id} className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-xs">
              <TravelImage src={hotel.image} alt={hotel.name} className="h-44 w-full object-cover" />
              <div className="space-y-2.5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{hotel.name}</h2>
                    <p className="text-[12px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="size-3 text-primary" />
                      <span>{hotel.district}</span>
                      <span>·</span>
                      <span>评分 {hotel.rating.toFixed(1)}</span>
                      <span>·</span>
                      <span>距行程路线中心约 {hotel.distanceToCenterKm} km</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-semibold text-foreground">
                      {formatCny(hotel.pricePerNight)}
                      <span className="text-[11px] font-normal text-muted-foreground"> / 晚起</span>
                    </p>
                    <span className="text-[10px] text-muted-foreground block">
                      2晚预估 {formatCny(hotel.pricePerNight * 2)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {hotel.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[11px] font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>

                <p className="text-[12px] leading-relaxed text-muted-foreground bg-secondary/30 rounded-[8px] p-2.5">
                  <Sparkles className="size-3 text-primary inline mr-1" />
                  <strong>AI 选址分析：</strong>{hotel.insight}
                </p>

                {/* Booking Provider Intent Buttons */}
                <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border/60">
                  <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className="text-[11px]">比价渠道:</span>
                    <button
                      type="button"
                      onClick={() => setSelectedProvider("trip")}
                      className={`px-2 py-0.5 rounded text-[11px] ${selectedProvider === "trip" ? "bg-primary text-white" : "hover:bg-secondary"}`}
                    >
                      携程
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedProvider("amap")}
                      className={`px-2 py-0.5 rounded text-[11px] ${selectedProvider === "amap" ? "bg-primary text-white" : "hover:bg-secondary"}`}
                    >
                      高德
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedProvider("booking")}
                      className={`px-2 py-0.5 rounded text-[11px] ${selectedProvider === "booking" ? "bg-primary text-white" : "hover:bg-secondary"}`}
                    >
                      Booking
                    </button>
                  </div>

                  <Button
                    size="sm"
                    className="gap-1.5 text-[12px]"
                    onClick={() => handleRedirect(hotel.name, activeOption)}
                  >
                    <span>在 {activeOption.providerName.split(" ")[0]} 预订</span>
                    <ExternalLink className="size-3" />
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
