"use client";

import { useMemo } from "react";
import { AlertTriangle, CalendarClock, Clock, Footprints, ShieldCheck } from "lucide-react";
import { getTripState } from "@/services/trip-state/engine";
import type { Trip } from "@/types/travel";

interface ActionCard {
  id: string;
  message: string;
  label: string;
}

function actionCards(state: NonNullable<ReturnType<typeof getTripState>>, dayId: string): ActionCard[] {
  const cards: ActionCard[] = [];
  for (const action of state.suggestedActions) {
    if (action.includes("晚") && action.includes("分钟")) {
      cards.push({ id: "late", message: `[dayId:${dayId}] 我现在比计划晚了，帮我砍掉或压缩一个低优先级站点`, label: "按晚点重排今天" });
    } else if (action.includes("雨")) {
      cards.push({ id: "rain", message: `[dayId:${dayId}] 下雨了，把露天安排换成室内方案`, label: "换室内方案" });
    } else if (action.includes("高温")) {
      cards.push({ id: "heat", message: `[dayId:${dayId}] 今天高温，把正午户外的安排调到早晚`, label: "避开正午" });
    } else if (action.includes("步行")) {
      cards.push({ id: "walk", message: `[dayId:${dayId}] 今天步行太多了，长步行段换成地铁或打车`, label: "减少步行" });
    } else if (action.includes("预算")) {
      cards.push({ id: "budget", message: "预估花费超预算了，帮我在今天的安排里省一点", label: "控制预算" });
    } else if (action.includes("尚未开始")) {
      continue;
    } else if (action.includes("预留时间")) {
      cards.push({ id: "reservation", message: "帮我看看前往下一个已确认预订的交通安排够不够", label: "检查赶路时间" });
    }
  }
  return cards;
}

/**
 * Today Execution Console (Phase 6.7).
 *
 * A deterministic strip driven by the TripState engine: where the traveller
 * is, how late, what's ahead, and what's risky — plus proactive action cards
 * that flow into the normal agent → Diff → confirm pipeline. Pure client-side
 * computation (the engine is a pure function), never a second source of truth.
 */
export function TripStateConsole({ trip, dayId, busy, onAct }: {
  trip: Trip;
  dayId: string | null;
  busy?: boolean;
  onAct: (message: string) => void;
}) {
  const state = useMemo(() => {
    try {
      return getTripState(trip);
    } catch {
      return null;
    }
  }, [trip]);

  if (!state) return null;
  if (state.phase !== "during" && !state.upcomingHardConstraints.length && !state.activeEvents.length) return null;

  const cards = actionCards(state, dayId ?? state.currentDay?.dayId ?? trip.days[0]?.id ?? "day-1");
  const riskTone = state.riskLevel === "high"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : state.riskLevel === "medium"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400";

  return (
    <section aria-label="行程执行台" className="mt-4 rounded-[14px] border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${riskTone}`}>
          {state.riskLevel === "low" ? <ShieldCheck className="size-3" /> : <AlertTriangle className="size-3" />}
          {state.phase === "during" ? `风险 ${state.riskLevel === "high" ? "高" : state.riskLevel === "medium" ? "中" : "低"}` : state.phase === "before" ? "行程未开始" : "行程已结束"}
        </span>
        {state.stale ? <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">数据可能过期（离线快照）</span> : null}
        {state.activeEvents.map((event) => (
          <span key={event.id} className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-foreground">
            {event.summary ?? event.type}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        {state.currentItem ? (
          <div>
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarClock className="size-3" />当前</p>
            <p className="font-medium">{state.currentItem.placeName}</p>
            <p className="text-[11px] text-muted-foreground">{state.currentItem.startTime} · {state.lateByMinutes !== null ? `晚 ${state.lateByMinutes} 分钟` : state.aheadByMinutes !== null ? `提前 ${state.aheadByMinutes} 分钟` : "准点"}</p>
          </div>
        ) : null}
        {state.nextItem ? (
          <div>
            <p className="text-[11px] text-muted-foreground">下一站</p>
            <p className="font-medium">{state.nextItem.placeName}</p>
            <p className="text-[11px] text-muted-foreground">{state.nextItem.startTime}</p>
          </div>
        ) : null}
        <div>
          <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Footprints className="size-3" />剩余步行</p>
          <p className="font-medium">{(state.remainingWalkingMeters / 1000).toFixed(1)} km</p>
          {state.estimatedFinishTime ? <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="size-3" />约 {state.estimatedFinishTime} 结束</p> : null}
        </div>
        {state.upcomingHardConstraints.length ? (
          <div>
            <p className="text-[11px] text-muted-foreground">最近的硬约束</p>
            <p className="font-medium">{state.upcomingHardConstraints[0].title}</p>
            <p className="text-[11px] text-muted-foreground">{new Date(state.upcomingHardConstraints[0].startAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        ) : null}
      </div>

      {cards.length ? (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border/70 pt-3">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              disabled={busy}
              onClick={() => onAct(card.message)}
              className="flex items-center justify-between rounded-[10px] border border-primary/25 bg-accent/70 px-3 py-2 text-left text-[12px] font-medium text-accent-foreground transition-colors hover:border-primary/50 disabled:opacity-40"
            >
              <span>{card.label}</span>
              <span className="text-[10px] text-muted-foreground">查看方案 →</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
