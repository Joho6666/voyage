"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MapPin, Plus, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TravelImage } from "@/components/travel/TravelImage";
import { AddToDay } from "@/components/travel/AddToDay";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { toast } from "sonner";
import type { Place } from "@/types/travel";

type Kind = "hotel" | "food" | "activity";
export type DiscoveryResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  image?: string;
  rating?: number;
  reviewCount?: number;
  cost?: number;
  score: number;
  insight: string;
  sourceId?: string;
  fetchedAt: string;
};

function resultToPlace(result: DiscoveryResult, kind: Kind): Place {
  const category = kind === "hotel" ? "hotel" : kind === "food" ? "food" : "activity";
  return {
    id: result.id.startsWith("amap-") ? result.id : `amap-${result.sourceId || result.id}`,
    name: result.name,
    category,
    lat: result.lat,
    lng: result.lng,
    rating: result.rating ?? 0,
    reviewCount: result.reviewCount ?? 0,
    image: result.image ?? "",
    priceLevel: result.cost && result.cost > 150 ? 3 : result.cost && result.cost > 60 ? 2 : 1,
    priceLabel: result.cost ? `约 ¥${Math.round(result.cost)}` : kind === "hotel" ? "房价以实际为准" : "价格未知",
    address: result.address || "",
    openingStatus: "unknown",
    stayMinutes: kind === "hotel" ? 0 : kind === "food" ? 70 : 90,
    description: result.insight || "",
    tags: [kind === "hotel" ? "住宿酒店" : kind === "food" ? "餐饮美食" : "特色体验", "高德实时POI"],
    district: "",
    source: "amap",
    sourceId: result.sourceId || result.id,
    provenance: { source: "amap", estimated: false },
  };
}

export function LiveDiscovery({
  city,
  kind,
  query,
  title,
}: {
  city: string;
  kind: Kind;
  query: string;
  title: string;
}) {
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const selectPlace = useUiStore((s) => s.selectPlace);

  useEffect(() => {
    if (!city) return;
    let active = true;
    setStatus("loading");
    const request = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch("/api/voyage/discover", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ city, kind, query, limit: 12 }),
            signal: AbortSignal.timeout(20_000),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.ok) throw new Error(payload.warning || payload.error || `实时查询失败（${response.status}）`);
          return payload as { results: DiscoveryResult[]; warning?: string };
        } catch (error) {
          lastError = error;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("实时查询暂时不可用");
    };
    request()
      .then((payload) => {
        if (!active) return;
        setResults(payload.results);
        setMessage(payload.warning || "");
        setStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        setStatus("error");
        setMessage(
          error instanceof Error && error.name === "TimeoutError"
            ? "高德实时查询超时，请点击刷新重试。"
            : "高德实时查询暂时不可用，请点击刷新重试。",
        );
      });
    return () => {
      active = false;
    };
  }, [city, kind, query, reload]);

  const ensurePlaceInTrip = (p: Place) => {
    if (!trip.places.some((existing) => existing.id === p.id)) {
      patch((t) => ({ ...t, places: [...t.places, p] }));
    }
  };

  const locateOnMap = (result: DiscoveryResult) => {
    const p = resultToPlace(result, kind);
    ensurePlaceInTrip(p);
    selectPlace(p.id);
    toast.success(`已在地图高亮定位：${result.name}`);
  };

  const addPlaceToMapOnly = (result: DiscoveryResult) => {
    const p = resultToPlace(result, kind);
    ensurePlaceInTrip(p);
    selectPlace(p.id);
    toast.success(`已加入地图标记：${result.name}`);
  };

  return (
    <section className="mt-5 rounded-[16px] border border-primary/20 bg-primary/[0.03] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            高德实时 POI · 发现的好店或酒店可直接加入地图或某天行程
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setReload((v) => v + 1)} disabled={status === "loading"}>
          <RefreshCw className={`mr-1 size-3 ${status === "loading" ? "animate-spin" : ""}`} />刷新
        </Button>
      </div>
      {message ? <p className="mt-2 text-[11px] text-muted-foreground">{message}</p> : null}
      {status === "loading" ? <p className="mt-4 text-center text-xs text-muted-foreground">正在搜索 {city}…</p> : null}
      {status === "error" ? (
        <div className="mt-4 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          <p>{message}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setReload((v) => v + 1)}>重新查询</Button>
        </div>
      ) : null}
      {status === "ready" && results.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">没有找到匹配结果，试试更换关键词。</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {results.map((result) => {
          const placeObj = resultToPlace(result, kind);
          const alreadyInMap = trip.places.some((p) => p.id === placeObj.id);
          const plannedCount = trip.items.filter((i) => i.placeId === placeObj.id).length;

          return (
            <article key={result.id} className="overflow-hidden rounded-xl border border-border bg-surface sm:flex">
              {result.image ? (
                <TravelImage src={result.image} alt={result.name} className="h-32 w-full object-cover sm:h-auto sm:w-36" />
              ) : null}
              <div className="min-w-0 flex-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="mb-1 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">高德 POI</Badge>
                      <Badge variant="outline" className="text-[10px]">参考分 {result.score}</Badge>
                      {alreadyInMap ? (
                        <Badge variant="teal" className="text-[10px] text-primary">已在地图</Badge>
                      ) : null}
                      {plannedCount > 0 ? (
                        <Badge variant="default" className="text-[10px] text-emerald-700">已排入行程</Badge>
                      ) : null}
                    </div>
                    <h3 className="text-sm font-semibold">{result.name}</h3>
                  </div>
                  <a
                    className="text-muted-foreground hover:text-primary transition-colors p-1"
                    href={`https://uri.amap.com/marker?position=${result.lng},${result.lat}&name=${encodeURIComponent(result.name)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="在高德官方查看"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{result.address || "地址未返回"}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Star className="size-3 fill-current" />
                    {result.rating?.toFixed(1) ?? "暂无评分"}
                  </span>
                  <span>{result.reviewCount ? `${result.reviewCount.toLocaleString()} 条评价` : "评价数未知"}</span>
                  <span>{result.cost ? `人均 ¥${result.cost}` : "人均未知"}</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{result.insight}</p>

                {/* Operations: View on map + Add to map/itinerary */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] px-2 gap-1"
                    onClick={() => locateOnMap(result)}
                  >
                    <MapPin className="size-3 text-primary" />
                    地图定位
                  </Button>
                  {!alreadyInMap ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] px-2 gap-1"
                      onClick={() => addPlaceToMapOnly(result)}
                    >
                      <Plus className="size-3" />
                      加入地图标记
                    </Button>
                  ) : null}
                  <AddToDay place={placeObj} label="加入行程" size="sm" variant="default" />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
