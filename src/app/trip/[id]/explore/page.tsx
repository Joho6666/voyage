"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PlaceCard } from "@/components/travel/PlaceCard";
import { useTripStore } from "@/store/trip-store";
import type { Place, PlaceCategory } from "@/types/travel";
import { uid, haversineMeters } from "@/lib/utils";
import { Search } from "lucide-react";

const TABS: { id: "all" | PlaceCategory | "museum" | "park"; label: string }[] = [
  { id: "all", label: "推荐全部" },
  { id: "attraction", label: "景点" },
  { id: "food", label: "美食" },
  { id: "cafe", label: "咖啡/茶" },
  { id: "museum", label: "博物馆" },
  { id: "park", label: "公园" },
  { id: "hotel", label: "酒店" },
  { id: "activity", label: "活动体验" },
  { id: "shopping", label: "商场" },
];

const QUICK_FILTERS = ["全部", "附近", "室内", "适合夜景", "免费", "少走路"] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number];

interface RemotePoi {
  sourceId: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  type: string;
  rating?: number;
  cost?: number;
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
    image: "",
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
  };
}

export default function ExplorePage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("全部");
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Place[]>([]);
  const [source, setSource] = useState<"amap" | "mock">("mock");
  const center = trip.places.find((p) => p.id === "p-jiefangbei") ?? trip.places[0];

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
          setSource(data.source === "amap" ? "amap" : "mock");
          const mapped = (data.pois ?? []).map(toPlace);
          setRemote(mapped);
          if (mapped.length) {
            patch((current) => {
              const extra = mapped.filter((p) => !current.places.some((x) => x.id === p.id));
              return extra.length ? { ...current, places: [...current.places, ...extra] } : current;
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
    const pool = source === "amap" && remote.length ? remote : trip.places;
    let filtered = pool.filter((p) => {
      if (tab === "museum" && !p.name.includes("博物馆") && !p.name.includes("美术馆")) return false;
      if (tab === "park" && !p.name.includes("公园")) return false;
      if (tab !== "all" && tab !== "museum" && tab !== "park" && p.category !== tab) return false;
      if (q && !p.name.includes(q) && !p.address.includes(q)) return false;

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

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">真实 POI 探索</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {source === "amap" ? "高德实时 POI 数据 · 真实坐标与营业状态" : "未配置高德 Key，显示精选真实地点库"}
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          className="pl-9 bg-surface"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索重庆美食、咖啡、博物馆、夜景..."
        />
      </div>

      {/* Quick Filter Chips (Requirement 九) */}
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
