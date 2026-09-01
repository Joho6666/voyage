"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { travelAgent } from "@/services/ai/mock";
import type { AgentMessage } from "@/services/ai/types";
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
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "我可以直接改行程，而不是只聊天。试试「Day 2 太赶了」。",
    },
  ]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content) return;
    const user: AgentMessage = { id: uid("msg"), role: "user", content };
    const reply = travelAgent.chat(trip, content);
    setMessages((m) => [...m, user, reply]);
    setDraft("");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex flex-col">
        <div className="border-b border-border px-4 py-4 pr-10">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI Assistant
          </SheetTitle>
          <p className="mt-1 text-[13px] text-muted-foreground">动作会写回当前旅行项目。</p>
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
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      patch(msg.proposal!.apply);
                      toast.success("行程已更新");
                    }}
                  >
                    应用修改
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-secondary"
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
                send(draft);
              }
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
