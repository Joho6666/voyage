"use client";

import { useState } from "react";
import { Sparkles, Undo2, Redo2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TripDiffModal } from "@/components/ai/TripDiffModal";
import { travelAgent } from "@/services/ai";
import type { AgentMessage } from "@/services/ai/types";
import type { TripChangeSet } from "@/types/diff";
import { useHistoryStore } from "@/store/history-store";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { uid } from "@/lib/utils";
import { toast } from "sonner";

const QUICK = ["Day 2 太赶了", "帮我省 ¥300", "减少走路", "多安排当地美食", "加入夜生活", "重新优化路线"];

export function AssistantSheet() {
  const open = useUiStore((s) => s.assistantOpen);
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const pushHistory = useHistoryStore((s) => s.push);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<{ changeSet: TripChangeSet; proposal: NonNullable<AgentMessage["proposal"]> } | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "我可以直接改行程，而不是只聊天。试试「Day 2 太赶了」。",
    },
  ]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const user: AgentMessage = { id: uid("msg"), role: "user", content };
    setMessages((m) => [...m, user]);
    setDraft("");
    setBusy(true);
    try {
      const reply = await travelAgent.chat(trip, content);
      setMessages((m) => [...m, reply]);
    } catch {
      toast.error("AI 请求失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  /** Every proposal must pass the Diff confirmation modal before it mutates the trip. */
  const reviewProposal = (proposal: NonNullable<AgentMessage["proposal"]>) => {
    if (proposal.changeSet) {
      setPendingDiff({ changeSet: proposal.changeSet, proposal });
      return;
    }
    applyProposal(proposal);
  };

  const applyProposal = (proposal: NonNullable<AgentMessage["proposal"]>) => {
    void (async () => {
      if (!proposal.remote) {
        pushHistory(trip); patch(proposal.apply); toast.success("行程已更新"); return;
      }
      const response = await fetch("/api/voyage/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "apply-change", input: { tripId: proposal.remote.tripId, proposalId: proposal.remote.proposalId, expectedTripRevision: proposal.remote.baseRevision, confirmed: true } }) });
      const envelope = await response.json() as { ok?: boolean; data?: { trip?: import("@/types/travel").Trip; revision?: number }; error?: { message?: string } };
      if (!response.ok || !envelope.ok || !envelope.data?.trip) { toast.error(envelope.error?.message ?? "方案已过期，请重新生成"); return; }
      pushHistory(trip); setTrip(envelope.data.trip, envelope.data.revision); toast.success("行程已确认并保存");
    })().catch(() => toast.error("应用修改失败，请重试"));
  };

  const onUndo = () => {
    const previous = undo(trip);
    if (previous) {
      setTrip(previous);
      toast.message("已撤销");
    } else {
      toast.message("没有可撤销的操作");
    }
  };

  const onRedo = () => {
    const next = redo(trip);
    if (next) {
      setTrip(next);
      toast.message("已重做");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex flex-col">
        <div className="flex items-start justify-between border-b border-border px-4 py-4 pr-10">
          <div>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              AI Assistant
            </SheetTitle>
            <p className="mt-1 text-[13px] text-muted-foreground">动作会写回当前旅行项目，可撤销。</p>
          </div>
          <div className="flex gap-1 pr-6">
            <Button variant="ghost" size="icon" onClick={onUndo} aria-label="撤销">
              <Undo2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onRedo} aria-label="重做">
              <Redo2 className="size-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 scrollbar-thin">
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  msg.role === "user"
                    ? "max-w-[85%] rounded-[12px] bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "max-w-[85%] rounded-[12px] bg-secondary px-3 py-2 text-sm"
                }
              >
                <p className="leading-6">{msg.content}</p>
                {msg.proposal ? (
                  <Button size="sm" className="mt-2" onClick={() => reviewProposal(msg.proposal!)}>
                    查看并应用修改
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {busy ? <p className="text-[13px] text-muted-foreground">AI 正在思考……</p> : null}
        </div>
        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => void send(q)}
                className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-secondary disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="直接告诉我要改哪一天……"
            className="min-h-[72px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
        </div>
        <TripDiffModal
          changeSet={pendingDiff?.changeSet ?? null}
          open={Boolean(pendingDiff)}
          onOpenChange={(next) => {
            if (!next) setPendingDiff(null);
          }}
          onApply={() => {
            const proposal = pendingDiff?.proposal;
            setPendingDiff(null);
            if (proposal) applyProposal(proposal);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
