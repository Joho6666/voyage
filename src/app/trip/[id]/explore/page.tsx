"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PlaceCard } from "@/components/travel/PlaceCard";
import { useTripStore } from "@/store/trip-store";
import type { PlaceCategory } from "@/types/travel";

const TABS: { id: "all" | PlaceCategory; label: string }[] = [
  { id: "all", label: "推荐" },
  { id: "attraction", label: "景点" },
  { id: "food", label: "美食" },
  { id: "cafe", label: "咖啡" },
  { id: "activity", label: "活动" },
  { id: "shopping", label: "购物" },
];

export default function ExplorePage() {
  const trip = useTripStore((s) => s.trip);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const center = trip.places.find((p) => p.id === "p-jiefangbei") ?? trip.places[0];
  const places = useMemo(() => {
    return trip.places.filter((p) => {
      if (tab !== "all" && p.category !== tab) return false;
      if (q && !p.name.includes(q)) return false;
      return true;
    });
  }, [q, tab, trip.places]);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">附近值得去哪里？</h1>
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
