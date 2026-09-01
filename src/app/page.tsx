"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/brand";

export default function LandingPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("从桂林去重庆玩 3 天，2 人，预算 2500，喜欢美食和夜景。");

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-sm font-medium">
          {brand.name}
          <span className="ml-1 text-muted-foreground">{brand.product}</span>
        </Link>
        <nav className="flex items-center gap-4 text-[13px]">
          <Link href="/trips" className="text-muted-foreground hover:text-foreground">
            我的旅行
          </Link>
          <Button asChild size="sm">
            <Link href="/new-trip">开始规划</Link>
          </Button>
        </nav>
      </header>

      <section className="relative mx-auto max-w-4xl px-6 pb-20 pt-16">
        <div className="absolute inset-x-8 top-8 -z-10 h-[420px] overflow-hidden rounded-[14px] bg-[var(--map-land)]">
          <div className="h-full w-full map-dots opacity-80" />
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "url(https://images.unsplash.com/photo-1474181487882-5abf3f0ba6c2?auto=format&fit=crop&w=1800&q=70)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </div>
        <h1 className="max-w-xl text-4xl font-medium leading-[1.15] tracking-tight text-balance sm:text-5xl">
          把一次旅行，
          <br />
          变成一张真正能走的路线。
        </h1>
        <p className="mt-5 max-w-xl text-[16px] leading-7 text-muted-foreground">
          {brand.description}
        </p>
        <form
          className="mt-8 rounded-[14px] border border-border bg-surface/95 p-3 shadow-[var(--shadow-float)]"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/new-trip?q=${encodeURIComponent(prompt)}`);
          }}
        >
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-24 border-0 bg-transparent text-[15px] focus-visible:ring-0"
          />
          <div className="flex justify-end">
            <Button type="submit">AI 创建旅行</Button>
          </div>
        </form>
      </section>

      <section className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3">
        {[
          { title: "Plan", body: "把日期、预算和偏好收成一份按天走的行程。" },
          { title: "Explore", body: "地图上找景点、火锅和当地活动，直接加入某一天。" },
          { title: "Travel", body: "出发后只看下一站。任务、天气、导航都在 Today。" },
        ].map((s) => (
          <div key={s.title}>
            <h2 className="text-sm font-medium">{s.title}</h2>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
