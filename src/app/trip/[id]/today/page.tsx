"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
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
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TravelImage } from "@/components/travel/TravelImage";
import { travelAgent } from "@/services/ai";
import type { AgentMessage, AgentTurn } from "@/services/ai/types";
import { suggestTodayActions } from "@/features/today/suggestions";
import { TripStateConsole } from "@/features/today/TripStateConsole";
import { toggleItemDone } from "@/features/today/check-in";
import { restoreTrip, TripCommandError } from "@/services/trip-commands";
import { postEnvelope, ApiError } from "@/lib/api-client";
import { useHistoryStore } from "@/store/history-store";
import { useTripStore, resyncTrip } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { useDayFocus } from "@/components/itinerary/useDayFocus";
import { dayStats } from "@/services/routing";
import { buildTodayContext } from "@/services/today/context";
import { buildWeatherContext } from "@/services/weather/context";
import { TripDiffModal } from "@/components/ai/TripDiffModal";
import { weatherDisplay } from "@/lib/weather-display";
import type { TripChangeSet } from "@/types/diff";
import { formatCny, formatKm } from "@/lib/utils";

/** Category labels for the budget breakdown (absorbed from the /budget page). */
const BUDGET_LABELS: Record<string, string> = {
  transport: "交通",
  stay: "住宿",
  food: "美食",
  ticket: "景点",
  shop: "购物",
  other: "其他",
};
import { toast } from "sonner";

export default function TodayPage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const persist = useTripStore((s) => s.persist);
  const pushHistory = useHistoryStore((s) => s.push);
  const undo = useHistoryStore((s) => s.undo);
  const setActiveDay = useUiStore((s) => s.setActiveDay);

  const [busy, setBusy] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [lastReply, setLastReply] = useState<AgentMessage | null>(null);
  const [activeDiff, setActiveDiff] = useState<TripChangeSet | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [activeRemote, setActiveRemote] = useState<{ tripId: string; proposalId: string; baseRevision: number; proposalToken: string } | null>(null);

  // Determine current day (matches system date if within range, else default to Day 2 or Day 1)
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultDay = trip.days.find((d) => d.date === todayIso) ?? trip.days[1] ?? trip.days[0];
  // The focused day is shared with the map and the itinerary column, so the
  // three views can no longer disagree about which day is being shown.
  const focusedDayId = useDayFocus();
  const selectedDayId = focusedDayId ?? defaultDay?.id ?? trip.days[0]?.id;

  const day = trip.days.find((d) => d.id === selectedDayId) ?? defaultDay;
  const weatherCtx = useMemo(() => buildWeatherContext(trip), [trip]);
  const dayWeather = weatherCtx.days.find((d) => d.dayId === day?.id);

  const items = useMemo(
    () => trip.items.filter((i) => i.dayId === day?.id).sort((a, b) => a.order - b.order),
    [trip.items, day?.id],
  );

  const currentIndex = items.findIndex((i) => i.status !== "done");
  // All stops checked off: there is no "next" — showing a done place as the
  // next target (the old behaviour) also made the arrival nudge able to
  // flip completed stops back to planned.
  const allDone = currentIndex < 0;
  const current = items[allDone ? items.length - 1 : currentIndex];
  const next = allDone ? undefined : items[currentIndex + 1];
  const currentPlace = trip.places.find((p) => p.id === current?.placeId);
  const nextPlace = trip.places.find((p) => p.id === next?.placeId);
  const segment = trip.segments.find((s) => s.fromItemId === current?.id);
  const doneCount = items.filter((i) => i.status === "done").length;

  const stats = useMemo(() => (day ? dayStats(trip, day.id) : null), [trip, day]);
  // Today console facts (remaining places/walking/end time, lateness) come from
  // the same shared pure function the runtime serves to agents, so the page
  // and the agent never disagree on the numbers.
  const todayConsole = useMemo(() => {
    if (!day) return null;
    try {
      return buildTodayContext(trip, { dayId: day.id });
    } catch {
      return null;
    }
  }, [trip, day]);
  // Proactive pulls: computed from trip facts each time the trip (or focus) changes.
  const suggestions = useMemo(
    () => suggestTodayActions(trip, selectedDayId ?? null, todayIso),
    [trip, selectedDayId, todayIso],
  );

  // Multi-turn context: follow-ups like "再少一点" resolve against what was
  // already said. The server caps this at 12 turns / 12k chars.
  const historyRef = useRef<AgentTurn[]>([]);

  // Action runner that triggers TripDiffModal
  const handleAction = async (message: string) => {
    if (busy) return;
    setBusy(true);
    const sentMessage = `[dayId:${day?.id ?? "day-1"}] ${message}`;
    try {
      const reply = await travelAgent.chat(trip, sentMessage, historyRef.current);
      historyRef.current = [
        ...historyRef.current,
        { role: "user" as const, content: sentMessage },
        { role: "assistant" as const, content: reply.content },
      ].slice(-8);
      setLastReply(reply);
      if (reply.proposal?.changeSet) {
        setActiveDiff(reply.proposal.changeSet);
        setActiveRemote(reply.proposal.remote ?? null);
        setDiffOpen(true);
      } else if (reply.proposal) {
        pushHistory(trip);
        patch(reply.proposal.apply);
        void persist();
        toast.success(reply.proposal.summary);
      }
      // Plain answers (weather, routes, places) stay visible in the reply
      // card above instead of a toast that disappears in seconds.
    } catch {
      toast.error("AI 请求失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleApplyDiff = (changeSet: TripChangeSet) => {
    void (async () => {
      // Every agent proposal carries a server-side remote record (the old
      // local-only apply path was removed with the mock agent surface).
      if (!activeRemote) { toast.error("方案已过期，请重新生成"); return; }
      const envelope = await postEnvelope<{ trip?: import("@/types/travel").Trip; revision?: number }>("/api/voyage/command", { command: "apply-change", input: { ...activeRemote, expectedTripRevision: activeRemote.baseRevision, confirmed: true } });
      if (!envelope.ok || !envelope.data?.trip) { toast.error(envelope.error?.message ?? "方案已过期，请重新生成"); return; }
      pushHistory(trip); setTrip(envelope.data.trip, envelope.data.revision); toast.success(`已应用：${changeSet.summary}`);
    })().catch((cause) => {
      // Preserve the root cause: a swallowed error here is unactionable.
      console.warn("voyage: apply-diff failed", cause);
      toast.error(cause instanceof ApiError || cause instanceof TripCommandError ? cause.message : "应用修改失败，请重试");
    });
  };

  // Direct one-click reschedule: no LLM round-trip, so it works in rule mode
  // too. The result is still a proposal — the same Diff confirmation the
  // assistant proposals go through, never a silent write.
  const runOptimizeItinerary = () => {
    if (busy) return;
    void (async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/voyage/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: "optimize-itinerary",
            input: { tripId: trip.id, expectedTripRevision: useTripStore.getState().revision, fallbackPolicy: "estimated" },
          }),
        });
        const envelope = await response.json() as { ok?: boolean; data?: { proposalId?: string; proposalToken?: string; baseRevision?: number; changes?: TripChangeSet; changed?: boolean; message?: string }; error?: { code?: string; message?: string } };
        if (!envelope.ok || !envelope.data) throw new TripCommandError(envelope.error?.message ?? "优化失败，请重试", envelope.error?.code);
        if (envelope.data.changed === false) {
          toast.message(envelope.data.message ?? "当前安排已是优化器的最优解");
          return;
        }
        if (!envelope.data.changes || !envelope.data.proposalId || !envelope.data.proposalToken) {
          throw new TripCommandError("优化服务没有返回可确认的提案，请重试");
        }
        setActiveDiff(envelope.data.changes);
        setActiveRemote({ tripId: trip.id, proposalId: envelope.data.proposalId, baseRevision: envelope.data.baseRevision!, proposalToken: envelope.data.proposalToken });
        setDiffOpen(true);
      } catch (cause) {
        if (cause instanceof TripCommandError && cause.code === "REVISION_CONFLICT") {
          toast.error("行程已在别处更新，已同步最新版本，请重试");
          void resyncTrip(trip.id);
          return;
        }
        toast.error(cause instanceof TripCommandError ? cause.message : "优化请求失败，请重试");
      } finally {
        setBusy(false);
      }
    })();
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
    // A bare sentence here used to be a dead end — the traveller had no way
    // forward except the browser back button.
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground">还没有行程。</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/new-trip">创建一次旅行</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/trips">返回列表</Link>
            </Button>
          </div>
        </div>
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
            {day.date} · {weatherDisplay(day.weather).text}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-[12px]"
          onClick={() => {
            const previous = undo(trip);
            if (!previous) { toast.message("没有可撤销的操作"); return; }
            // Undo is a real server write now (see AssistantSheet.onUndo) —
            // a local restore would diverge from the server immediately.
            void restoreTrip({ tripId: trip.id, trip: previous, expectedTripRevision: useTripStore.getState().revision })
              .then(({ trip: saved, revision: savedRevision }) => { setTrip(saved, savedRevision); toast.success("已恢复上一步行程"); })
              .catch((error) => {
                if (error instanceof TripCommandError && error.code === "REVISION_CONFLICT") {
                  toast.error("行程已在别处更新，已同步最新版本，请重试");
                  void resyncTrip(trip.id);
                  return;
                }
                toast.error(error instanceof TripCommandError ? error.message : "撤销失败，请重试");
              });
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
            onClick={() => setActiveDay(d.id)}
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

      {/* Proactive suggestions: deterministic rules over trip facts (weather,
          gaps, budget, quotes) pull the traveller instead of waiting to be
          discovered inside the drawer. */}
      {suggestions.length ? (
        <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">可以根据当前行程状态，试试：</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                disabled={busy}
                onClick={() => void handleAction(suggestion.message)}
                className="rounded-full border border-primary/25 bg-accent/70 px-3 py-1.5 text-[11px] font-medium text-accent-foreground transition-colors hover:border-primary/50 disabled:opacity-40"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Phase 6.7 execution console: TripState-driven strip (risk, current/
          next stop, lateness, remaining walking, hard constraints) with
          proactive cards that flow into the normal agent → Diff pipeline. */}
      <TripStateConsole trip={trip} dayId={selectedDayId ?? null} busy={busy} onAct={(message) => void handleAction(message)} />

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

        {/* Budget breakdown (absorbed from the removed /budget page) */}
        {trip.budgetItems.length > 0 ? (
          <details className="mt-2 rounded-[10px] border border-border/70 px-2.5 py-1.5">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">
              预算明细 · 总 {formatCny(trip.budget)} · 预计 {formatCny(trip.estimatedSpend)} · 剩余 {formatCny(Math.max(0, trip.budget - trip.estimatedSpend))}
            </summary>
            <div className="mt-2 space-y-1.5 pb-1">
              {trip.budgetItems.map((item) => (
                <div key={item.id}>
                  <div className="flex justify-between text-[11px]">
                    <span>{BUDGET_LABELS[item.category] ?? item.label}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCny(item.planned)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(item.planned / Math.max(...trip.budgetItems.map((b) => b.planned), 1)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {/* Next Stop Hero Section */}
        <div className="mt-3.5 flex items-start justify-between gap-2">
          <div>
            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
              下一站目标
            </span>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              {allDone ? "今日行程已完成 🎉" : nextPlace?.name ?? currentPlace?.name ?? "今日行程已完成"}
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {allDone ? (
                "今天的节点都已打卡完成，好好休息。"
              ) : (
                <>建议出发：<span className="font-medium text-foreground">{current?.endTime || current?.startTime || "09:30"}</span> · 预计到达：<span className="font-medium text-foreground">{next?.startTime || "10:00"}</span></>
              )}
            </p>
          </div>
          {!allDone ? (
            <div className="text-right">
              <span className="text-[12px] font-medium text-foreground block">
                {segment?.mode === "metro" ? "地铁" : segment?.mode === "taxi" ? "出租" : "步行"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                约 {segment?.durationMinutes || segment?.minutes || 15} 分钟
              </span>
            </div>
          ) : null}
        </div>

        {/* Navigation Button */}
        {!allDone ? (
          <Button
            className="mt-4 w-full h-11 text-[13px] font-medium shadow-sm gap-2"
            onClick={openNavigation}
          >
            <Navigation className="size-4" />
            开始导航（高德地图）
          </Button>
        ) : null}

        {/* Today execution console (Today Mode v2): remaining budget for the
            day, computed by the same shared pure function the runtime's
            get-today-context command serves to agents. */}
        {todayConsole ? (
          <div className="mt-3 rounded-[10px] border border-border/70 px-3 py-2">
            {todayConsole.lateMinutes !== null && todayConsole.lateMinutes > 30 ? (
              <p className="mb-1.5 text-[11px] font-medium text-amber-700">
                比计划晚了约 {todayConsole.lateMinutes} 分钟
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                今天剩余：<span className="font-medium text-foreground">{todayConsole.remaining.places}</span> 个地点
              </span>
              <span>
                剩余步行 <span className="font-medium text-foreground tabular-nums">{todayConsole.remaining.walkMeters >= 1000 ? `${(todayConsole.remaining.walkMeters / 1000).toFixed(1)} km` : `${todayConsole.remaining.walkMeters} m`}</span>
              </span>
              <span>
                预计结束 <span className="font-medium text-foreground tabular-nums">{todayConsole.remaining.estimatedEndTime ?? "—"}</span>
              </span>
            </div>
          </div>
        ) : null}
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

      {/* Latest agent reply: persistent (toasts vanished in seconds), showing
          what the model answered, which tools it called, and a way back to a
          proposal Diff that was closed without applying. */}
      {lastReply ? (
        <section className="mt-4 rounded-[14px] border border-primary/20 bg-surface p-3.5" aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-foreground">{lastReply.content}</p>
            {lastReply.proposal?.changeSet ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => {
                  setActiveDiff(lastReply.proposal!.changeSet!);
                  setActiveRemote(lastReply.proposal!.remote ?? null);
                  setDiffOpen(true);
                }}
              >
                查看修改方案
              </Button>
            ) : null}
          </div>
          {lastReply.toolCalls?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {lastReply.toolCalls.map((call, index) => (
                <span
                  key={`${call.name}-${index}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${call.ok ? "bg-secondary text-muted-foreground" : "bg-amber-500/10 text-amber-700"}`}
                  title={`工具调用：${call.name}`}
                >
                  {call.ok ? "✓" : "!"} {call.name} · {call.summary}
                </span>
              ))}
            </div>
          ) : null}
          {lastReply.warnings?.length ? (
            <p className="mt-2 text-[11px] text-amber-700">{lastReply.warnings.join("；")}</p>
          ) : null}
        </section>
      ) : null}

      {/* Adjustments stay behind one tap: eight always-visible buttons competed
          with the itinerary for attention, and most days need none of them. */}
      <section className="mt-5">
        <details className="rounded-[14px] border border-border bg-surface/60">
          <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-medium text-muted-foreground">需要帮忙？（临时调整今天的安排）</summary>
          <div className="grid grid-cols-2 gap-2 p-3 pt-1 sm:grid-cols-4">
            <ActionButton
              icon={WandSparkles}
              label="一键优化行程"
              sub="按位置聚类重排全部天"
              disabled={busy}
              onClick={runOptimizeItinerary}
            />
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
          {/* Free-form AI input: the AssistantSheet chat was removed to keep a
              single AI surface, so natural language lives here beside the
              one-tap buttons. */}
          <form
            className="flex gap-2 px-3 pb-3 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              const text = freeText.trim();
              if (!text) return;
              setFreeText("");
              void handleAction(text);
            }}
          >
            <Input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="或直接说：把明早改成 9 点出发 / 想去能看江景的咖啡店…"
              className="h-9 text-[13px]"
              aria-label="自由描述今天的调整"
              disabled={busy}
            />
            <Button type="submit" size="sm" disabled={busy || !freeText.trim()} className="shrink-0">
              <WandSparkles className="size-3.5" />
              发送
            </Button>
          </form>
        </details>
      </section>

      {/* Day Timeline Execution List */}
      <section className="mt-6">
        <div className="flex items-center justify-between px-1 mb-2.5">
          {/* Live region: check-ins previously gave screen readers no feedback
              beyond the focused control's own label change. */}
          <span className="text-[13px] font-medium text-foreground" aria-live="polite">
            今日节点清单 ({doneCount}/{items.length})
          </span>
          <span className="text-[11px] text-muted-foreground">
            点击整行打卡 · 再点一次取消
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
                role="checkbox"
                aria-checked={isDone}
                tabIndex={0}
                onClick={() => toggleItemDone(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleItemDone(item.id);
                  }
                }}
                className={`flex items-center gap-3 rounded-[12px] border p-3 cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-ring ${
                  isCurrent
                    ? "border-primary/40 bg-accent/40 shadow-xs"
                    : isDone
                      ? "border-border/40 bg-secondary/30 opacity-60"
                      : "border-border bg-surface hover:bg-secondary/40"
                }`}
              >
                <span
                  className={`grid size-5.5 place-items-center rounded-full border text-[11px] font-medium shrink-0 transition-colors ${
                    isDone
                      ? "border-primary bg-primary text-white"
                      : isCurrent
                        ? "border-primary text-primary"
                        : "border-muted-foreground/40 text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {isDone ? "✓" : index + 1}
                </span>

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
