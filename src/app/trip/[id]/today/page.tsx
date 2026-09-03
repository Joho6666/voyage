"use client";

import { useMemo, useState } from "react";
import { CloudRain, Footprints, Navigation, Train, Car, Ticket, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TravelImage } from "@/components/travel/TravelImage";
import { travelAgent } from "@/services/ai";
import { useHistoryStore } from "@/store/history-store";
import { useTripStore } from "@/store/trip-store";
import { formatKm } from "@/lib/utils";
import { toast } from "sonner";

const QUICK = [
  { label: "太累了", message: "今天太累了，减少走路并优化顺序" },
  { label: "少走路", message: "减少走路" },
  { label: "调整顺序", message: "重新优化路线" },
  { label: "找附近吃的", message: "多安排当地美食" },
];

export default function TodayPage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const pushHistory = useHistoryStore((s) => s.push);
  const undo = useHistoryStore((s) => s.undo);
  const [busy, setBusy] = useState(false);

  const day = trip.days[1] ?? trip.days[0];
  const items = useMemo(
    () => trip.items.filter((i) => i.dayId === day?.id).sort((a, b) => a.order - b.order),
    [trip.items, day?.id],
  );
  const currentIndex = items.findIndex((i) => i.status !== "done");
  const current = items[currentIndex] ?? items[0];
  const next = items[currentIndex + 1] ?? items[1];
  const currentPlace = trip.places.find((p) => p.id === current?.placeId);
  const nextPlace = trip.places.find((p) => p.id === next?.placeId);
  const segment = trip.segments.find((s) => s.fromItemId === current?.id);
  const doneCount = items.filter((i) => i.status === "done").length;
  const food = trip.places.find((p) => p.category === "food" && !trip.items.some((i) => i.placeId === p.id && i.dayId === day?.id));

  const runQuick = async (message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      pushHistory(trip);
      const reply = await travelAgent.chat(trip, message);
      if (reply.proposal) {
        patch(reply.proposal.apply);
        toast.success(reply.proposal.summary);
      } else {
        toast.message(reply.content);
      }
    } catch {
      toast.error("AI 请求失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  if (!day) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        还没有行程。先去创建一次旅行。
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground">{trip.destination}</p>
          <h1 className="mt-1 text-2xl font-medium">今日行程</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {trip.destination} · Day {day.index + 1} · {day.weather.tempC}°C {day.weather.condition}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="撤销"
          onClick={() => {
            const previous = undo(trip);
            if (previous) setTrip(previous);
            else toast.message("没有可撤销的操作");
          }}
        >
          <Undo2 className="size-4" />
        </Button>
      </div>

      <section className="mt-5 rounded-[14px] border border-border bg-surface p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
          <div>
            <p className="text-[12px] text-muted-foreground">当前</p>
            <p className="mt-0.5 font-medium">{currentPlace?.name ?? "—"}</p>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="text-right">
            <p className="text-[12px] text-muted-foreground">下一站</p>
            <p className="mt-0.5 font-medium">{nextPlace?.name ?? "结束"}</p>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          建议出发 {next?.startTime ?? current?.startTime ?? "—"}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
          <ModeChip icon={Footprints} label="步行" value={segment ? `${segment.minutes} min · ${formatKm(segment.meters)}` : "—"} />
          <ModeChip icon={Train} label="地铁" value={segment?.mode === "metro" ? `${segment.minutes} min` : "备选"} />
          <ModeChip icon={Car} label="出租" value={segment?.mode === "taxi" ? `${segment.minutes} min` : "约 16 元"} />
        </div>
      </section>

      {nextPlace ? (
        <section className="relative mt-4 overflow-hidden rounded-[14px] border border-border">
          <TravelImage src={nextPlace.image} alt={nextPlace.name} ratio="16/9" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
            <p className="text-[12px] opacity-80">下一站</p>
            <h2 className="text-lg font-medium">{nextPlace.name}</h2>
            <p className="mt-1 text-[12px] opacity-80">
              {nextPlace.tags.slice(0, 2).join(" · ") || nextPlace.district}
            </p>
            <Button
              className="mt-3"
              onClick={() => toast.message("导航使用 Mock Location / 高德外链")}
            >
              <Navigation className="size-3.5" />
              开始导航
            </Button>
          </div>
        </section>
      ) : null}

      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between text-[13px]">
          <span className="font-medium">行程进度</span>
          <span className="text-muted-foreground">
            {doneCount}/{items.length} 个地点
          </span>
        </div>
        <div className="flex gap-1.5">
          {items.map((item, index) => (
            <span
              key={item.id}
              className={`h-1.5 flex-1 rounded-full ${index < doneCount ? "bg-primary" : index === currentIndex ? "bg-primary/50" : "bg-secondary"}`}
            />
          ))}
        </div>
      </section>

      <ol className="mt-5 space-y-2">
        {items.map((item, index) => {
          const place = trip.places.find((p) => p.id === item.placeId);
          const done = item.status === "done" || index < doneCount;
          const isNext = item.id === next?.id;
          return (
            <li key={item.id} className="flex items-center gap-3 rounded-[12px] border border-transparent px-1 py-2">
              <span className="grid size-5 place-items-center text-[12px] text-primary">
                {done ? "✓" : isNext ? "●" : "○"}
              </span>
              <span className="w-12 tabular-nums text-[12px] text-muted-foreground">{item.startTime}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${done ? "text-muted-foreground line-through" : ""}`}>
                  {place?.name}
                </p>
                {isNext ? <p className="text-[12px] text-muted-foreground">下一站 · 建议停留 {item.duration} min</p> : null}
              </div>
              {place?.category === "activity" ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Ticket className="size-3" />
                  查看票券
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {food ? (
        <button
          type="button"
          className="mt-5 flex w-full items-center gap-3 rounded-[14px] border border-border p-3 text-left hover:bg-secondary"
          onClick={() => void runQuick("多安排当地美食")}
        >
          <TravelImage src={food.image} alt={food.name} className="h-14 w-20 rounded-[10px]" />
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground">为你推荐的午餐</p>
            <p className="truncate text-sm font-medium">{food.name}</p>
            <p className="text-[12px] text-muted-foreground">
              {food.rating.toFixed(1)} 分 · {food.priceLabel}
            </p>
          </div>
        </button>
      ) : null}

      <section className="mt-6 rounded-[14px] border border-border p-3">
        <p className="text-[13px] font-medium">需要 AI 帮你调整吗？</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={busy}
              onClick={() => void runQuick(q.message)}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary disabled:opacity-40"
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      <p className="mt-4 inline-flex items-center gap-1 text-[12px] text-muted-foreground">
        <CloudRain className="size-3.5" />
        {day.weather.condition} · {day.weather.tempC}°C · 天气来自高德（无 Key 时用行程内置）
      </p>
    </div>
  );
}

function ModeChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Footprints;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[10px] bg-secondary px-2 py-2">
      <p className="inline-flex items-center gap-1 text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </p>
      <p className="mt-0.5 font-medium text-foreground">{value}</p>
    </div>
  );
}
