"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PlaceCard } from "@/components/travel/PlaceCard";
import { useTripStore } from "@/store/trip-store";
import type { Place, PlaceCategory } from "@/types/travel";
import { uid } from "@/lib/utils";

const TABS: { id: "all" | PlaceCategory; label: string }[] = [
  { id: "all", label: "推荐" },
  { id: "attraction", label: "景点" },
  { id: "food", label: "美食" },
  { id: "cafe", label: "咖啡" },
  { id: "hotel", label: "酒店" },
  { id: "activity", label: "活动" },
  { id: "shopping", label: "购物" },
];

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

function categorize(type: string): PlaceCategory {
  if (/餐饮|美食|餐厅|小吃|火锅|面/.test(type)) return "food";
  if (/咖啡|茶座|奶茶/.test(type)) return "cafe";
  if (/酒店|宾馆|民宿/.test(type)) return "hotel";
  if (/购物|商场/.test(type)) return "shopping";
  if (/演出|剧场|娱乐|体育/.test(type)) return "activity";
  return "attraction";
}

function toPlace(poi: RemotePoi): Place {
  const category = categorize(poi.type);
  return {
    id: `amap-${poi.sourceId || uid("poi")}`,
    name: poi.name,
    category,
    lat: poi.lat,
    lng: poi.lng,
    rating: poi.rating ?? 4.2,
    reviewCount: 0,
    image: "",
    priceLevel: 1,
    priceLabel: poi.cost ? `¥${Math.round(poi.cost)}` : undefined,
    address: poi.address,
    openingStatus: "unknown",
    stayMinutes: 60,
    description: poi.type.split(";")[0] ?? "",
    tags: ["高德"],
    district: "",
    source: "amap",
    sourceId: poi.sourceId,
  };
}

export default function ExplorePage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Place[]>([]);
  const [source, setSource] = useState<"amap" | "mock">("mock");
  const center = trip.places.find((p) => p.id === "p-jiefangbei") ?? trip.places[0];

  useEffect(() => {
    const keywords = q.trim() || (tab === "all" ? "景点" : TABS.find((t) => t.id === tab)?.label || "景点");
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
    return pool.filter((p) => {
      if (tab !== "all" && p.category !== tab) return false;
      if (q && !p.name.includes(q) && !p.address.includes(q)) return false;
      return true;
    });
  }, [q, tab, trip.places, remote, source]);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">附近值得去哪里？</h1>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {source === "amap" ? "高德 POI · AI 可按距离和偏好二次排序" : "未配置高德 Key，显示行程内地点"}
      </p>
      <Input className="mt-3" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索地点" />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-3 py-1 text-[12px] ${tab === t.id ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-4">
        {places.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有匹配的地点。试试别的分类或关键词。</p>
        ) : (
          places.map((place) => <PlaceCard key={place.id} place={place} from={center} />)
        )}
      </div>
    </div>
  );
}
