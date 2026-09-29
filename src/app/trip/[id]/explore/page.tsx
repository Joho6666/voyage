"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlaceCard } from "@/components/travel/PlaceCard";
import { XhsGuidePanel } from "@/components/travel/XhsGuidePanel";
import { LiveDiscovery } from "@/components/travel/LiveDiscovery";
import { AddToDay } from "@/components/travel/AddToDay";
import { TravelImage } from "@/components/travel/TravelImage";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import type { Place, PlaceCategory } from "@/types/travel";
import { uid, haversineMeters, formatCny, formatShortDate } from "@/lib/utils";
import { Building, ExternalLink, MapPin, Search } from "lucide-react";
import { toast } from "sonner";

const TABS: { id: "all" | PlaceCategory | "museum" | "park"; label: string }[] = [
  { id: "all", label: "推荐全部" },
  { id: "attraction", label: "景点" },
  { id: "food", label: "美食" },
  { id: "hotel", label: "住宿" },
  { id: "activity", label: "活动体验" },
  { id: "cafe", label: "咖啡/茶" },
  { id: "museum", label: "博物馆" },
  { id: "park", label: "公园" },
  { id: "shopping", label: "商场" },
];

/** The absorbed food page's cuisine presets drive the LiveDiscovery query. */
const CUISINES = ["全部", "火锅", "小面", "江湖菜", "烧烤", "甜品", "夜宵", "咖啡"];

const QUICK_FILTERS = ["全部", "附近", "室内", "适合夜景", "免费", "少走路"] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number];

/** Tabs that carry a discovery pipeline (the old standalone pages). */
type DiscoveryKind = "food" | "hotel" | "activity";
function discoveryKindFor(tab: string): DiscoveryKind | null {
  if (tab === "food" || tab === "hotel" || tab === "activity") return tab;
  return null;
}

interface RemotePoi {
  sourceId: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  type: string;
  rating?: number;
  cost?: number;
  image?: string;
}

function categorize(type: string, name: string): PlaceCategory {
  if (/餐饮|美食|餐厅|小吃|火锅|面/.test(type) || /火锅|小面|餐馆/.test(name)) return "food";
  if (/咖啡|茶座|奶茶|甜品/.test(type) || /咖啡|茶馆/.test(name)) return "cafe";
  if (/酒店|宾馆|民宿|旅馆/.test(type) || /酒店|客栈/.test(name)) return "hotel";
  if (/购物|商场|百货|超市/.test(type) || /商场|百货/.test(name)) return "shopping";
  if (/演出|剧场|娱乐|体育|索道|展/.test(type) || /索道|体验|Livehouse/.test(name)) return "activity";
  if (/观景台|眺望/.test(type) || /桥|步道|观景/.test(name)) return "viewpoint";
  return "attraction";
}

function toPlace(poi: RemotePoi): Place {
  const category = categorize(poi.type, poi.name);
  const isMuseum = poi.name.includes("博物馆") || poi.name.includes("陈列馆") || poi.name.includes("美术馆");
  const isNight = poi.name.includes("夜景") || poi.name.includes("洪崖洞") || poi.name.includes("南滨路") || poi.name.includes("码头");
  const isFree = !poi.cost || poi.cost === 0;

  const tags: string[] = ["高德真实POI"];
  if (isMuseum) tags.push("室内");
  if (isNight) tags.push("夜景");
  if (isFree) tags.push("免费");

  return {
    id: `amap-${poi.sourceId || uid("poi")}`,
    name: poi.name,
    category,
    lat: poi.lat,
    lng: poi.lng,
    rating: typeof poi.rating === "number" && poi.rating > 0 ? poi.rating : 0,
    reviewCount: 0,
    image: poi.image ?? "",
    priceLevel: poi.cost && poi.cost > 150 ? 3 : poi.cost && poi.cost > 60 ? 2 : 1,
    priceLabel: poi.cost ? `约 ¥${Math.round(poi.cost)}` : "免费",
    address: poi.address,
    openingStatus: "unknown",
    stayMinutes: isMuseum ? 90 : 60,
    description: poi.type.split(";")[0] ?? "",
    tags,
    district: "",
    source: "amap",
    sourceId: poi.sourceId,
    // The POI came straight from the AMap search above; recording that here is
    // what lets add-place-item accept it server-side.
    provenance: { source: "amap", estimated: false },
  };
}

/** One card for a place already collected into this trip (absorbed from the old standalone pages). */
function CollectedCard({ place }: { place: Place }) {
  const selectPlace = useUiStore((s) => s.selectPlace);
  const locateOnMap = () => {
    selectPlace(place.id);
    toast.success(`已在地图定位：${place.name}`);
  };
  return (
    <article className="rounded-[14px] border border-border bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">已在地图</Badge>
            <h3 className="text-sm font-semibold truncate">{place.name}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">{place.address || place.district}</p>
          {place.priceLabel ? <p className="text-[11px] text-muted-foreground mt-0.5">{place.priceLabel}</p> : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-8 px-2 text-[11px] gap-1" onClick={locateOnMap}>
            <MapPin className="size-3 text-primary" />
            地图定位
          </Button>
          <AddToDay place={place} label="加入行程" />
        </div>
      </div>
    </article>
  );
}

export default function ExplorePage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("全部");
  const [q, setQ] = useState("");
  const [cuisine, setCuisine] = useState("全部");
  const [remote, setRemote] = useState<Place[]>([]);
  const [source, setSource] = useState<"amap" | "known" | "unknown">("unknown");
  // Distance anchor = where the traveler is staying; the old hardcoded demo id
  // ("p-jiefangbei") made every real trip fall back to places[0] → "0 m".
  const center = trip.places.find((p) => p.category === "hotel") ?? trip.places[0];
  const discoveryKind = discoveryKindFor(tab);

  useEffect(() => {
    let keywords = q.trim();
    if (!keywords) {
      if (tab === "museum") keywords = "博物馆";
      else if (tab === "park") keywords = "公园";
      else if (tab !== "all") keywords = TABS.find((t) => t.id === tab)?.label || "景点";
      else keywords = "景点";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/amap/poi?city=${encodeURIComponent(trip.destination)}&keywords=${encodeURIComponent(keywords)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json() as Promise<{ source?: "amap" | "mock"; pois?: RemotePoi[] }>)
        .then((data) => {
          setSource(data.source === "amap" ? "amap" : "known");
          const mapped = (data.pois ?? []).map(toPlace);
          setRemote(mapped);
          if (mapped.length) {
            patch((current) => {
              const liveById = new Map(mapped.map((place) => [place.id, place]));
              let changed = false;
              const enriched = current.places.map((place) => {
                const live = liveById.get(place.id);
                if (live?.image && !place.image) { changed = true; return { ...place, image: live.image }; }
                return place;
              });
              const extra = mapped.filter((place) => !current.places.some((existing) => existing.id === place.id));
              if (!changed && !extra.length) return current;
              return { ...current, places: [...enriched, ...extra] };
            });
          }
        })
        .catch(() => setRemote([]));
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, tab, trip.destination, patch]);

  const places = useMemo(() => {
    const verifiedTripPlaces = trip.places.filter((place) => place.provenance?.source === "amap" || place.source === "amap");
    const knownTripPlaces = verifiedTripPlaces.length ? verifiedTripPlaces : trip.places;
    const usingRemote = source === "amap" && remote.length > 0;
    const pool = usingRemote ? remote : knownTripPlaces;
    let filtered = pool.filter((p) => {
      if (tab === "museum" && !p.name.includes("博物馆") && !p.name.includes("美术馆")) return false;
      if (tab === "park" && !p.name.includes("公园")) return false;
      if (tab !== "all" && tab !== "museum" && tab !== "park" && p.category !== tab) return false;
      // The remote pool was already keyword-matched by AMap; re-filtering it
      // by literal substring killed legitimate fuzzy results (e.g. brands
      // whose names never contain the query), leaving the page empty.
      if (q && !usingRemote && !p.name.includes(q) && !p.address.includes(q)) return false;

      // Quick filter logic
      if (quickFilter === "室内") {
        return p.name.includes("馆") || p.tags.includes("室内") || p.category === "shopping";
      }
      if (quickFilter === "适合夜景") {
        return p.tags.includes("夜景") || p.name.includes("夜") || p.name.includes("江") || p.name.includes("洪崖洞") || p.name.includes("桥");
      }
      if (quickFilter === "免费") {
        return p.priceLevel === 0 || !p.priceLabel || p.priceLabel.includes("免费") || p.tags.includes("免费");
      }
      return true;
    });

    if (quickFilter === "少走路" || quickFilter === "附近") {
      if (center) {
        filtered = [...filtered].sort((a, b) => haversineMeters(center, a) - haversineMeters(center, b));
      }
    }

    return filtered;
  }, [q, tab, quickFilter, trip.places, remote, source, center]);

  // Collected places for the active discovery tab (absorbed sections).
  const collected = useMemo(() => {
    if (discoveryKind === "food") {
      return trip.places.filter((p) => p.category === "food" && (p.provenance?.source === "amap" || p.source === "amap"));
    }
    if (discoveryKind === "hotel") {
      return trip.places.filter((p) => p.category === "hotel");
    }
    return [];
  }, [discoveryKind, trip.places]);

  const headerSubtitle =
    discoveryKind === "food" ? "美食探店 · 小红书爆款与高德实时发现"
    : discoveryKind === "hotel" ? "住宿规划 · 发现心仪酒店直接加入地图或行程"
    : discoveryKind === "activity" ? "当地活动 · 演出、展览与体验"
    : source === "amap" ? "高德实时 POI 数据 · 真实坐标与营业状态"
    : "暂无实时高德搜索结果 · 展示当前行程中已有地点，并保留其原始数据来源";

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{trip.destination} 探索</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{headerSubtitle}</p>
      </div>

      {/* 小红书攻略：美食 tab 切到美食类别，其余走路线攻略 */}
      <div className="mt-4">
        <XhsGuidePanel
          city={trip.destination}
          defaultCategory={discoveryKind === "food" ? "food" : "route"}
          title={discoveryKind === "food" ? "小红书爆款美食推荐" : undefined}
          description={discoveryKind === "food" ? "精选小红书美食探店与必吃榜笔记，一键解析出真实餐厅并添加到地图或行程。" : undefined}
        />
      </div>

      {/* Search Bar */}
      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          className="pl-9 bg-surface"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`搜索${trip.destination}美食、咖啡、博物馆、夜景...`}
        />
      </div>

      {/* Quick Filter Chips */}
      <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-[11px] text-muted-foreground shrink-0 font-medium mr-0.5">筛选：</span>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setQuickFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors shrink-0 ${
              quickFilter === f
                ? "bg-primary text-white"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 border border-border/60"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Category Tabs */}
      <div className="mt-2 flex flex-wrap gap-1.5 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              tab === t.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/80 bg-surface text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Absorbed discovery pipelines (formerly the food/hotels/activities pages) */}
      {discoveryKind === "food" ? (
        <section className="mt-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">热门美食分类</h2>
            <span className="text-[11px] text-muted-foreground">高德实时发现</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
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
        </section>
      ) : null}

      {discoveryKind === "hotel" ? (
        <section className="mt-5 space-y-3">
          <section className="rounded-[14px] border border-border bg-secondary/40 p-3.5 text-[12px] leading-5">
            <div className="flex items-center gap-1.5 font-medium">
              <Building className="size-4 text-primary" />住宿选址建议
            </div>
            <p className="mt-1 text-muted-foreground">
              优先选择靠近当前行程核心景点、地铁或餐饮街区的区域；通过下方高德实时发现可直接在地图中查看方位并加入行程。
            </p>
          </section>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={`/trip/${encodeURIComponent(trip.id)}/offers`}>查询酒店实时房价</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="https://hotels.ctrip.com/" target="_blank" rel="noreferrer">
                外部携程查询 <ExternalLink className="ml-1 size-3" />
              </a>
            </Button>
          </div>
          <LiveDiscovery
            city={trip.destination}
            kind="hotel"
            query="高档酒店 舒适型酒店 精选民宿"
            title={`${trip.destination} · 热门酒店口碑与位置发现`}
          />
        </section>
      ) : null}

      {discoveryKind === "activity" ? (
        <section className="mt-5 space-y-3">
          <LiveDiscovery city={trip.destination} kind="activity" query="演出 展览 景点体验 休闲娱乐" title={`${trip.destination} 可探索的体验与活动`} />
        </section>
      ) : null}

      {/* Current trip's activities (absorbed from the activities page) */}
      {discoveryKind === "activity" && trip.activities.length > 0 ? (
        <section className="mt-4 space-y-4">
          <h2 className="text-sm font-semibold">已加入行程的活动（{trip.activities.length}）</h2>
          {trip.activities.map((activity) => (
            <article key={activity.id} className="overflow-hidden rounded-[14px] border border-border">
              <TravelImage src={activity.banner} alt={activity.name} ratio="16/9" />
              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">{activity.name}</h3>
                    <p className="text-[12px] text-muted-foreground">
                      {formatShortDate(activity.date)} · {activity.startTime}–{activity.endTime} · {activity.venue}
                    </p>
                  </div>
                  <p className="text-sm">{activity.price ? formatCny(activity.price) : "免费"}</p>
                </div>
                <p className="text-[13px] text-muted-foreground">{activity.insight}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">{activity.remaining}</span>
                  <AddToDay placeId={activity.placeId} label="加入行程" />
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {/* Collected places for the active kind (absorbed from the old pages) */}
      {discoveryKind && collected.length > 0 ? (
        <section className="mt-5 space-y-3">
          <h2 className="text-sm font-semibold">
            当前行程收录的{discoveryKind === "food" ? "美食地点" : "住宿"}（{collected.length}）
          </h2>
          {collected.map((place) => <CollectedCard key={place.id} place={place} />)}
        </section>
      ) : null}

      {/* Results Grid */}
      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        {places.length === 0 ? (
          <div className="col-span-2 rounded-[14px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            没有匹配的地点。试试清除关键词或切换其他分类。
          </div>
        ) : (
          places.map((place) => <PlaceCard key={place.id} place={place} from={center} />)
        )}
      </div>
    </div>
  );
}
