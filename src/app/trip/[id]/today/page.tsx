"use client";

import { useMemo, useState } from "react";
import {
  CloudRain,
  Footprints,
  Navigation,
  Ticket,
  Undo2,
  Clock,
  Coins,
  Umbrella,
  BedDouble,
  FastForward,
  Utensils,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TravelImage } from "@/components/travel/TravelImage";
import { travelAgent } from "@/services/ai";
import { useHistoryStore } from "@/store/history-store";
import { useTripStore } from "@/store/trip-store";
import { dayStats } from "@/services/routing";
import { buildWeatherContext } from "@/services/weather/context";
import { TripDiffModal } from "@/components/ai/TripDiffModal";
import type { TripChangeSet } from "@/types/diff";
import { formatKm } from "@/lib/utils";
import { toast } from "sonner";

export default function TodayPage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const persist = useTripStore((s) => s.persist);
  const pushHistory = useHistoryStore((s) => s.push);
  const undo = useHistoryStore((s) => s.undo);

  const [busy, setBusy] = useState(false);
  const [activeDiff, setActiveDiff] = useState<TripChangeSet | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [activeRemote, setActiveRemote] = useState<{ tripId: string; proposalId: string; baseRevision: number } | null>(null);

  // Determine current day (matches system date if within range, else default to Day 2 or Day 1)
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultDay = trip.days.find((d) => d.date === todayIso) ?? trip.days[1] ?? trip.days[0];
  const [selectedDayId, setSelectedDayId] = useState<string>(defaultDay?.id ?? "day-1");

  const day = trip.days.find((d) => d.id === selectedDayId) ?? defaultDay;
  const weatherCtx = useMemo(() => buildWeatherContext(trip), [trip]);
  const dayWeather = weatherCtx.days.find((d) => d.dayId === day?.id);

  const items = useMemo(
    () => trip.items.filter((i) => i.dayId === day?.id).sort((a, b) => a.order - b.order),
    [trip.items, day?.id],
  );

  const currentIndex = items.findIndex((i) => i.status !== "done");
  const current = items[currentIndex >= 0 ? currentIndex : 0];
  const next = items[currentIndex >= 0 ? currentIndex + 1 : 1] ?? current;
  const currentPlace = trip.places.find((p) => p.id === current?.placeId);
  const nextPlace = trip.places.find((p) => p.id === next?.placeId);
  const segment = trip.segments.find((s) => s.fromItemId === current?.id);
  const doneCount = items.filter((i) => i.status === "done").length;

  const stats = useMemo(() => (day ? dayStats(trip, day.id) : null), [trip, day]);

  // Action runner that triggers TripDiffModal
  const handleAction = async (message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const reply = await travelAgent.chat(trip, `[dayId:${day?.id ?? "day-1"}] ${message}`);
      if (reply.proposal?.changeSet) {
        setActiveDiff(reply.proposal.changeSet);
        setActiveRemote(reply.proposal.remote ?? null);
        setDiffOpen(true);
      } else if (reply.proposal) {
        pushHistory(trip);
        patch(reply.proposal.apply);
        void persist();
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

  const handleApplyDiff = (changeSet: TripChangeSet) => {
    void (async () => {
      if (!activeRemote) { pushHistory(trip); setTrip(changeSet.proposedTrip); void persist(); toast.success(`已应用：${changeSet.summary}`); return; }
      const response = await fetch("/api/voyage/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "apply-change", input: { ...activeRemote, expectedTripRevision: activeRemote.baseRevision, confirmed: true } }) });
      const envelope = await response.json() as { ok?: boolean; data?: { trip?: import("@/types/travel").Trip; revision?: number }; error?: { message?: string } };
      if (!response.ok || !envelope.ok || !envelope.data?.trip) { toast.error(envelope.error?.message ?? "方案已过期，请重新生成"); return; }
      pushHistory(trip); setTrip(envelope.data.trip, envelope.data.revision); toast.success(`已应用：${changeSet.summary}`);
    })().catch(() => toast.error("应用修改失败，请重试"));
  };

  const toggleItemDone = (itemId: string) => {
    patch((currentTrip) => {
      return {
        ...currentTrip,
        items: currentTrip.items.map((i) =>
          i.id === itemId ? { ...i, status: i.status === "done" ? "planned" : "done" } : i,
        ),
      };
    });
    void persist();
  };

  const openNavigation = () => {
    if (!nextPlace) {
      toast.error("未找到目的地坐标");
      return;
    }
    const mode = segment?.mode === "walk" ? "walk" : segment?.mode === "metro" ? "bus" : "car";
    const amapWebUrl = `https://uri.amap.com/navigation?to=${nextPlace.lng},${nextPlace.lat}&toname=${encodeURIComponent(nextPlace.name)}&mode=${mode}&policy=1`;
    window.open(amapWebUrl, "_blank", "noopener,noreferrer");
    toast.success(`正在拉起高德地图导航至 ${nextPlace.name}`);
  };

  if (!day) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        还没有行程。先去创建一次旅行。
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 pb-28 scrollbar-thin max-w-2xl mx-auto">
      {/* Header & Days Switcher */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-primary tracking-wide uppercase">
              {trip.destination} · 今日行程 · 现场执行模式
            </span>
          </div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
            {trip.destination} · Day {day.index + 1}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {day.date} · {day.weather.tempC}°C {day.weather.condition}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-[12px]"
          onClick={() => {
            const previous = undo(trip);
            if (previous) {
              setTrip(previous);
              void persist();
              toast.success("已恢复上一步行程");
            } else {
              toast.message("没有可撤销的操作");
            }
          }}
        >
          <Undo2 className="size-3.5" />
          撤销
        </Button>
      </div>

      {/* Day Selector Tabs */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {trip.days.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setSelectedDayId(d.id)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors shrink-0 ${
              d.id === day.id
                ? "bg-primary text-white"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80"
            }`}
          >
            Day {d.index + 1} · {d.title || d.date.slice(5)}
          </button>
        ))}
      </div>

      {/* Weather Advisory Alert */}
      {dayWeather?.isRainy || dayWeather?.isExtremeHeat ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[12px] border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5 text-[12px] text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <CloudRain className="size-4 shrink-0 text-amber-600" />
            <span>{dayWeather.advisory}</span>
          </div>
          {dayWeather.isRainy ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAction("下雨方案")}
              className="shrink-0 font-medium underline hover:opacity-80"
            >
              换下雨方案
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Live Travel Status Card */}
      <section className="mt-4 rounded-[14px] border border-border bg-surface p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 pb-3 border-b border-border/70 text-[13px]">
          <div>
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Footprints className="size-3" />
              今日步行
            </span>
            <p className="mt-0.5 text-base font-semibold text-foreground">
              {stats ? formatKm(stats.meters) : "—"}
            </p>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Coins className="size-3" />
              今日预算规划
            </span>
            <p className="mt-0.5 text-base font-semibold text-foreground">
              已安排 ¥{Math.round(trip.estimatedSpend / trip.days.length)} / 日
            </p>
          </div>
        </div>

        {/* Next Stop Hero Section */}
        <div className="mt-3.5 flex items-start justify-between gap-2">
          <div>
            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
              下一站目标
            </span>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              {nextPlace?.name ?? currentPlace?.name ?? "今日行程已完成"}
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              建议出发：<span className="font-medium text-foreground">{current?.endTime || current?.startTime || "09:30"}</span> · 预计到达：<span className="font-medium text-foreground">{next?.startTime || "10:00"}</span>
            </p>
          </div>
          <div className="text-right">
            <span className="text-[12px] font-medium text-foreground block">
              {segment?.mode === "metro" ? "地铁" : segment?.mode === "taxi" ? "出租" : "步行"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              约 {segment?.durationMinutes || segment?.minutes || 15} 分钟
            </span>
          </div>
        </div>

        {/* Navigation Button */}
        <Button
          className="mt-4 w-full h-11 text-[13px] font-medium shadow-sm gap-2"
          onClick={openNavigation}
        >
          <Navigation className="size-4" />
          开始导航（高德地图）
        </Button>
      </section>

      {/* Hero Destination Image if available */}
      {nextPlace?.image ? (
        <div className="relative mt-3 h-32 overflow-hidden rounded-[14px] border border-border">
          <TravelImage src={nextPlace.image} alt={nextPlace.name} ratio="16/9" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-3">
            <p className="text-[12px] text-white/90">
              {nextPlace.tags.slice(0, 3).join(" · ") || nextPlace.address || nextPlace.district}
            </p>
          </div>
        </div>
      ) : null}

      {/* Core Action Thumb Grid (Section 五 Requirement) */}
      <section className="mt-5">
        <p className="text-[12px] font-medium text-muted-foreground px-1 mb-2">
          现场快速调整（单手操作）
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ActionButton
            icon={BedDouble}
            label="我累了"
            sub="减少爬坡与步行"
            disabled={busy}
            onClick={() => void handleAction("今天太累了，减少走路")}
          />
          <ActionButton
            icon={Footprints}
            label="少走路"
            sub="长距离自动改打车"
            disabled={busy}
            onClick={() => void handleAction("减少走路")}
          />
          <ActionButton
            icon={Umbrella}
            label="下雨方案"
            sub="切换室内文化展馆"
            disabled={busy}
            onClick={() => void handleAction("下雨方案")}
          />
          <ActionButton
            icon={Clock}
            label="推迟一小时"
            sub="今天全天行程延后"
            disabled={busy}
            onClick={() => void handleAction("推迟一小时")}
          />
          <ActionButton
            icon={FastForward}
            label="跳过这一站"
            sub="直奔下一目的地"
            disabled={busy}
            onClick={() => void handleAction("跳过当前这站")}
          />
          <ActionButton
            icon={Utensils}
            label="找附近吃的"
            sub="推荐顺路正宗美食"
            disabled={busy}
            onClick={() => void handleAction("多安排当地美食")}
          />
          <ActionButton
            icon={Coins}
            label="今天省100"
            sub="打车改地铁与平价餐"
            disabled={busy}
            onClick={() => void handleAction("今天帮我省100块钱")}
          />
          <ActionButton
            icon={RefreshCw}
            label="换个地方"
            sub="替换为同类好评地标"
            disabled={busy}
            onClick={() => void handleAction("换个地方")}
          />
        </div>
      </section>

      {/* Day Timeline Execution List */}
      <section className="mt-6">
        <div className="flex items-center justify-between px-1 mb-2.5">
          <span className="text-[13px] font-medium text-foreground">
            今日节点清单 ({doneCount}/{items.length})
          </span>
          <span className="text-[11px] text-muted-foreground">
            点击圆圈切换打卡状态
          </span>
        </div>

        <div className="space-y-1.5">
          {items.map((item, index) => {
            const place = trip.places.find((p) => p.id === item.placeId);
            const isDone = item.status === "done";
            const isCurrent = item.id === current?.id && !isDone;

            return (
              <div
                key={item.id}
                onClick={() => toggleItemDone(item.id)}
                className={`flex items-center gap-3 rounded-[12px] border p-3 cursor-pointer transition-all ${
                  isCurrent
                    ? "border-primary/40 bg-accent/40 shadow-xs"
                    : isDone
                      ? "border-border/40 bg-secondary/30 opacity-60"
                      : "border-border bg-surface hover:bg-secondary/40"
                }`}
              >
                <button
                  type="button"
                  className={`grid size-5.5 place-items-center rounded-full border text-[11px] font-medium shrink-0 transition-colors ${
                    isDone
                      ? "border-primary bg-primary text-white"
                      : isCurrent
                        ? "border-primary text-primary"
                        : "border-muted-foreground/40 text-muted-foreground"
                  }`}
                  aria-label={isDone ? "已打卡" : "未打卡"}
                >
                  {isDone ? "✓" : index + 1}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-medium truncate ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {place?.name}
                    </span>
                    {isCurrent ? (
                      <span className="rounded bg-primary/10 text-primary px-1.5 py-0.2 text-[10px] font-medium">
                        当前站
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {item.startTime} · 停留约 {item.duration} 分钟 · {place?.category === "food" ? "美食品尝" : "景点打卡"}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  {place?.category === "activity" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                      <Ticket className="size-3" />
                      票券
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {item.startTime}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Diff Review Modal */}
      <TripDiffModal
        changeSet={activeDiff}
        open={diffOpen}
        onOpenChange={setDiffOpen}
        onApply={handleApplyDiff}
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  sub,
  disabled,
  onClick,
}: {
  icon: typeof BedDouble;
  label: string;
  sub: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-start p-3 rounded-[12px] border border-border bg-surface hover:bg-secondary/60 active:scale-[0.98] transition-all text-left disabled:opacity-50"
    >
      <div className="grid size-7 place-items-center rounded-[8px] bg-secondary text-primary mb-1.5">
        <Icon className="size-4" />
      </div>
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      <span className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{sub}</span>
    </button>
  );
}
