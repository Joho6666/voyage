"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, Send, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PlanningMessage } from "./types";

function StreamingText({ content, animate }: { content: string; animate: boolean }) {
  const [visible, setVisible] = useState(animate ? "" : content);

  useEffect(() => {
    if (!animate) {
      setVisible(content);
      return;
    }

    let cursor = 0;
    const step = Math.max(1, Math.ceil(content.length / 80));
    setVisible("");
    const timer = window.setInterval(() => {
      cursor = Math.min(content.length, cursor + step);
      setVisible(content.slice(0, cursor));
      if (cursor >= content.length) window.clearInterval(timer);
    }, 18);

    return () => window.clearInterval(timer);
  }, [animate, content]);

  const isStreaming = animate && visible.length < content.length;
  return (
    <>
      <span className="whitespace-pre-wrap">{visible}</span>
      {isStreaming ? <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-current align-middle" aria-hidden="true" /> : null}
    </>
  );
}

function MessageBubble({ message, animate }: { message: PlanningMessage; animate: boolean }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="mx-auto max-w-[92%] rounded-full border border-border bg-muted/45 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
        {message.content}
      </div>
    );
  }

  return (
    <article className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-primary/20 bg-accent text-accent-foreground">
          <Bot className="size-3.5" />
        </span>
      ) : null}
      <div className={cn("max-w-[min(88%,560px)]", isUser ? "items-end" : "items-start")}>
        <div className={cn(
          "rounded-[16px] px-3.5 py-3 text-[13px] leading-6 shadow-xs",
          isUser
            ? "rounded-br-[5px] bg-primary text-primary-foreground"
            : "rounded-bl-[5px] border border-border bg-surface text-foreground",
        )}>
          <StreamingText content={message.content} animate={animate} />
        </div>
        <p className={cn("mt-1 text-[10px] text-muted-foreground", isUser ? "text-right" : "text-left")}>
          {isUser ? "你" : "Voyage 规划师"}
        </p>
      </div>
      {isUser ? (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-background">
          <UserRound className="size-3.5" />
        </span>
      ) : null}
    </article>
  );
}

export interface PlanningChatProps {
  messages: PlanningMessage[];
  suggestedReplies: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (message?: string) => void;
  disabled?: boolean;
  isTyping?: boolean;
  streamingMessageId?: string | null;
}

export function PlanningChat({
  messages,
  suggestedReplies,
  draft,
  onDraftChange,
  onSend,
  disabled = false,
  isTyping = false,
  streamingMessageId,
}: PlanningChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages.length, isTyping]);

  return (
    <section className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-[0_18px_50px_rgba(28,25,23,0.06)]">
      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">一起把路线说清楚</h2>
            <p className="text-[11px] text-muted-foreground">你可以随时补充、修改或推翻刚才的想法</p>
          </div>
        </div>
        <span className="hidden rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-muted-foreground sm:inline-flex">
          对话会自动整理成路线画像
        </span>
      </div>

      <div ref={scrollRef} className="scrollbar-thin min-h-[360px] max-h-[620px] space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.08),transparent_34%),linear-gradient(180deg,rgba(245,245,244,0.52),transparent_42%)] px-4 py-5 sm:px-6">
        {messages.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center text-center">
            <div className="max-w-xs">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-primary/15 bg-accent text-primary">
                <Sparkles className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium">从一个模糊的念头开始</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">目的地、时间、同行人、预算，不确定的也可以先说。</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} animate={message.id === streamingMessageId} />
          ))
        )}
        {isTyping ? (
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground" aria-live="polite">
            <span className="grid size-7 place-items-center rounded-full border border-primary/20 bg-accent text-primary"><Bot className="size-3.5" /></span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-2">
              正在整理
              <span className="flex gap-0.5" aria-hidden="true"><i className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" /><i className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" /><i className="size-1 animate-bounce rounded-full bg-current" /></span>
            </span>
          </div>
        ) : null}
      </div>

      {suggestedReplies.length > 0 && !isTyping ? (
        <div className="border-t border-border/70 px-4 py-3 sm:px-5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">可以这样继续</p>
          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
            {suggestedReplies.slice(0, 5).map((reply) => (
              <button
                key={reply}
                type="button"
                onClick={() => onSend(reply)}
                disabled={disabled}
                className="shrink-0 rounded-full border border-primary/20 bg-accent/60 px-3 py-1.5 text-left text-[12px] text-accent-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                {reply}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        className="border-t border-border bg-surface p-3 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <div className="flex items-end gap-2 rounded-[16px] border border-input bg-background p-2 transition-colors focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/10">
          <Textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            disabled={disabled}
            rows={2}
            className="min-h-12 resize-none border-0 bg-transparent px-2 py-1.5 text-[13px] leading-5 shadow-none focus-visible:ring-0"
            placeholder="比如：少走路…… 或直接粘贴小红书/抖音攻略链接，自动解析成路线"
            aria-label="补充旅行偏好"
          />
          <Button type="submit" size="icon" disabled={disabled || !draft.trim()} aria-label="发送消息" className="mb-0.5 shrink-0">
            {disabled ? <LoaderCircle className="animate-spin" /> : <Send />}
          </Button>
        </div>
        <p className="mt-2 px-1 text-[10px] text-muted-foreground">Enter 发送 · Shift + Enter 换行</p>
      </form>
    </section>
  );
}
