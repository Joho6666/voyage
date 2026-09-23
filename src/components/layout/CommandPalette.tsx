"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Sparkles,
  Navigation,
  Footprints,
  Umbrella,
  Clock,
  Coins,
  FastForward,
  Utensils,
  MapPin,
  Compass,
  ArrowRight,
} from "lucide-react";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { useHistoryStore } from "@/store/history-store";
import { travelAgent } from "@/services/ai";
import { TripDiffModal } from "@/components/ai/TripDiffModal";
import type { TripChangeSet } from "@/types/diff";
import { toast } from "sonner";

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const persist = useTripStore((s) => s.persist);
  const pushHistory = useHistoryStore((s) => s.push);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeDiff, setActiveDiff] = useState<TripChangeSet | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [activeRemote, setActiveRemote] = useState<{ tripId: string; proposalId: string; baseRevision: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const places = useMemo(
    () => trip.places.filter((p) => p.name.includes(query) || query === ""),
    [query, trip.places],
  );

  const handleExecuteCommand = async (commandText: string) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    toast.loading("AI 正在计算行程优化提案...", { id: "cmd-planner" });
    try {
      const reply = await travelAgent.chat(trip, commandText);
      toast.dismiss("cmd-planner");
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
      toast.dismiss("cmd-planner");
      toast.error("命令执行失败，请重试");
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

  if (!open && !diffOpen) return null;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-[70] bg-[var(--overlay)] flex items-start justify-center pt-[10vh] p-4" onClick={() => setOpen(false)}>
          <Command
            className="w-full max-w-xl overflow-hidden rounded-[16px] border border-border bg-surface shadow-[var(--shadow-float)] animate-in fade-in-0 zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center border-b border-border px-3.5">
              <Sparkles className="size-4 text-primary shrink-0 mr-2.5" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="输入旅行命令（例如：今晚少走一点、下雨方案、推迟一小时、省100）..."
                className="h-13 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
              />
              {query.trim() ? (
                <button
                  type="button"
                  onClick={() => void handleExecuteCommand(query)}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs text-white font-medium shrink-0 ml-2"
                >
                  执行
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground/60 border border-border px-1.5 py-0.5 rounded font-mono">
                  Esc
                </span>
              )}
            </div>

            <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
              <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
                <p>按下 Enter 将 &ldquo;{query}&rdquo; 作为指令发送给 AI 行程规划器</p>
                <button
                  type="button"
                  onClick={() => void handleExecuteCommand(query)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>立即执行</span>
                  <ArrowRight className="size-3" />
                </button>
              </Command.Empty>

              {/* AI Travel Actions Group */}
              <Command.Group heading="快捷旅行指令 (ActionPlanner)" className="px-1 py-1.5 text-[11px] font-medium text-muted-foreground">
                <Item onSelect={() => void handleExecuteCommand("今天太累了，减少走路")}>
                  <Footprints className="size-3.5 text-primary mr-2" />
                  <span>今晚少走一点 / 我累了 (长距离自动换乘打车/地铁)</span>
                </Item>
                <Item onSelect={() => void handleExecuteCommand("下雨方案")}>
                  <Umbrella className="size-3.5 text-primary mr-2" />
                  <span>切换下雨预案 (露天景点替换为室内博物馆)</span>
                </Item>
                <Item onSelect={() => void handleExecuteCommand("推迟一小时")}>
                  <Clock className="size-3.5 text-primary mr-2" />
                  <span>推迟一小时 (后续行程节点整体后移 60 分钟)</span>
                </Item>
                <Item onSelect={() => void handleExecuteCommand("今天帮我省100块钱")}>
                  <Coins className="size-3.5 text-primary mr-2" />
                  <span>今天省100元 (交通与餐饮微调优化)</span>
                </Item>
                <Item onSelect={() => void handleExecuteCommand("跳过当前这一站")}>
                  <FastForward className="size-3.5 text-primary mr-2" />
                  <span>跳过这一站 (衔接重算前往下一站)</span>
                </Item>
                <Item onSelect={() => void handleExecuteCommand("多安排当地美食")}>
                  <Utensils className="size-3.5 text-primary mr-2" />
                  <span>寻找附近正宗美食 (火锅/小面顺路插入)</span>
                </Item>
              </Command.Group>

              {/* Navigation Group */}
              <Command.Group heading="页面跳转" className="px-1 py-1.5 text-[11px] font-medium text-muted-foreground">
                <Item onSelect={() => { router.push(`/trip/${trip.id}`); setOpen(false); }}>
                  <Compass className="size-3.5 mr-2 text-muted-foreground" />
                  <span>行程总览 Itinerary</span>
                </Item>
                <Item onSelect={() => { router.push(`/trip/${trip.id}/today`); setOpen(false); }}>
                  <Navigation className="size-3.5 mr-2 text-primary" />
                  <span>Today 现场模式 (单手执行控制台)</span>
                </Item>
                <Item onSelect={() => { router.push(`/trip/${trip.id}/explore`); setOpen(false); }}>
                  <MapPin className="size-3.5 mr-2 text-muted-foreground" />
                  <span>Explore 真实地点探索</span>
                </Item>
                <Item onSelect={() => { router.push("/trips"); setOpen(false); }}>
                  我的行程列表 Trips
                </Item>
              </Command.Group>

              {/* Places Quick Select */}
              <Command.Group heading="行程地点" className="px-1 py-1.5 text-[11px] font-medium text-muted-foreground">
                {places.slice(0, 6).map((place) => (
                  <Item
                    key={place.id}
                    onSelect={() => {
                      selectPlace(place.id);
                      setOpen(false);
                      router.push(`/trip/${trip.id}`);
                    }}
                  >
                    <span className="size-1.5 rounded-full bg-primary mr-2 shrink-0" />
                    <span className="truncate">{place.name}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto">{place.category}</span>
                  </Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      ) : null}

      {/* Proposal Diff Modal triggered from Command Bar */}
      <TripDiffModal
        changeSet={activeDiff}
        open={diffOpen}
        onOpenChange={setDiffOpen}
        onApply={handleApplyDiff}
      />
    </>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center rounded-[8px] px-2.5 py-2 text-[13px] text-foreground aria-selected:bg-secondary transition-colors"
    >
      {children}
    </Command.Item>
  );
}
