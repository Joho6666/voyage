"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/brand";
import { ArrowRight, Compass, Sparkles, Navigation, Calendar, Shuffle } from "lucide-react";

const SUGGESTIONS = [
  "从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。",
  "成都出发自驾川西4天，2人，摄影风景，避开高反。",
  "杭州周末2日慢游，独行，咖啡馆、独立书店与西湖徒步。",
];

export default function LandingPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    "从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/new-trip?q=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col justify-between">
      {/* Top Header */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <div className="size-6 rounded-[6px] bg-primary text-white grid place-items-center text-xs font-bold shadow-xs">
            V
          </div>
          <span>{brand.name}</span>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
            Travel OS Beta
          </span>
        </Link>
        <nav className="flex items-center gap-3 text-[13px]">
          <Link href="/trips" className="text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">
            我的旅行
          </Link>
          <Button asChild size="sm" className="h-8 shadow-xs">
            <Link href="/new-trip">进入工作台</Link>
          </Button>
        </nav>
      </header>

      {/* Hero: Direct, Minimalist, Action-Oriented */}
      <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
        <div className="space-y-3 text-center sm:text-left">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-3 py-1 text-[12px] text-muted-foreground">
            <Sparkles className="size-3 text-primary" />
            <span>AI-Native Travel Operating System</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.15] text-balance">
            Tell Voyage where you&apos;re going.
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl text-balance">
            输入自然语言，自动生成带真实坐标、路网交通、实时天气与预算的结构化行程。
          </p>
        </div>

        {/* The Prompt Console */}
        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-[16px] border border-border bg-surface p-3.5 shadow-[var(--shadow-float)] transition-all focus-within:border-primary/50"
        >
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。"
            className="min-h-28 resize-none border-0 bg-transparent text-[15px] leading-relaxed placeholder:text-muted-foreground/60 focus-visible:ring-0 p-1"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground overflow-x-auto py-1">
              <span className="shrink-0 text-[11px]">快捷灵感:</span>
              <button
                type="button"
                onClick={() => setPrompt(SUGGESTIONS[0]!)}
                className="rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] hover:bg-secondary truncate max-w-[200px]"
              >
                桂林 → 重庆 3天
              </button>
              <button
                type="button"
                onClick={() => setPrompt(SUGGESTIONS[1]!)}
                className="rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] hover:bg-secondary truncate max-w-[200px]"
              >
                川西 4天自驾
              </button>
            </div>

            <Button type="submit" className="gap-1.5 text-sm h-9 px-4 font-medium shadow-sm">
              <span>生成完整旅行</span>
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </form>

        {/* 4 Core Pillars of Voyage: Plan, Explore, Adapt, Travel */}
        <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-[12px] border border-border/70 bg-surface p-3.5 space-y-1">
            <div className="size-7 rounded-[6px] bg-primary/10 text-primary grid place-items-center mb-2">
              <Calendar className="size-3.5" />
            </div>
            <h3 className="text-sm font-semibold">1. Plan</h3>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              真实高德 POI 与路网规划，生成按天执行的时间轴与预算。
            </p>
          </div>

          <div className="rounded-[12px] border border-border/70 bg-surface p-3.5 space-y-1">
            <div className="size-7 rounded-[6px] bg-primary/10 text-primary grid place-items-center mb-2">
              <Compass className="size-3.5" />
            </div>
            <h3 className="text-sm font-semibold">2. Explore</h3>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              探索地道火锅、咖啡与文化地标，一键顺路插进行程。
            </p>
          </div>

          <div className="rounded-[12px] border border-border/70 bg-surface p-3.5 space-y-1">
            <div className="size-7 rounded-[6px] bg-primary/10 text-primary grid place-items-center mb-2">
              <Shuffle className="size-3.5" />
            </div>
            <h3 className="text-sm font-semibold">3. Adapt</h3>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              “太累了 / 下雨了 / 省100”，AI 生成量化 Diff 待你审阅。
            </p>
          </div>

          <div className="rounded-[12px] border border-border/70 bg-surface p-3.5 space-y-1">
            <div className="size-7 rounded-[6px] bg-primary/10 text-primary grid place-items-center mb-2">
              <Navigation className="size-3.5" />
            </div>
            <h3 className="text-sm font-semibold">4. Travel</h3>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Today 现场执行模式：下一站、出发倒计时与单手导航。
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-5xl px-6 py-6 border-t border-border/60 text-center sm:flex sm:justify-between text-[12px] text-muted-foreground">
        <p>Voyage · AI-Native Travel OS · Real World Travel Beta</p>
        <p className="mt-1 sm:mt-0">高德地图 · 真实路网 · 结构化 TravelAction</p>
      </footer>
    </div>
  );
}
