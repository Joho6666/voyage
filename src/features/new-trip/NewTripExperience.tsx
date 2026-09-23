"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/brand";
import { travelAgent } from "@/services/ai";
import type { GenerationStep } from "@/services/ai/types";
import { hydrateTrip } from "@/store/trip-store";

const CHIPS = ["3天2夜", "周末游", "学生穷游", "情侣", "独自旅行", "亲子", "美食", "摄影", "自然", "城市漫游", "轻松", "特种兵"];

function inferPromptFields(text: string) {
  const route = text.match(/从\s*([^，,。\s]{2,20})\s*(?:去|到)\s*([^，,。\s]{2,20})/);
  const days = text.match(/(\d+)\s*天/);
  const people = text.match(/(\d+)\s*(?:人|位)/);
  const budget = text.match(/预算\s*[¥￥]?\s*(\d+)/i);
  return {
    origin: route?.[1] ?? undefined,
    destination: route?.[2]?.replace(/玩.*$/, "") ?? undefined,
    days: days ? Number(days[1]) : undefined,
    travelers: people ? Number(people[1]) : undefined,
    budget: budget ? Number(budget[1]) : undefined,
  };
}

export function NewTripExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState("从桂林去重庆玩 3 天，2 人，预算 2500，喜欢美食和夜景。");
  const [origin, setOrigin] = useState("桂林");
  const [destination, setDestination] = useState("重庆");
  const [dates, setDates] = useState("2026-09-20");
  const [endDate, setEndDate] = useState("2026-09-22");
  const [travelers, setTravelers] = useState("2");
  const [budget, setBudget] = useState("2500");
  const [vibes, setVibes] = useState<string[]>(["美食", "轻松"]);
  const [includeOffers, setIncludeOffers] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<GenerationStep[]>([]);
  const [markers, setMarkers] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setPrompt(q);
  }, [searchParams]);

  const preview = useMemo(() => travelAgent.generationSteps({ prompt }), [prompt]);

  const run = async () => {
    const inferred = inferPromptFields(prompt);
    const requestOrigin = inferred.origin ?? origin;
    const requestDestination = inferred.destination ?? destination;
    const requestTravelers = inferred.travelers ?? (Number(travelers) || 2);
    const requestBudget = inferred.budget ?? (Number(budget) || 2500);
    const requestEndDate = inferred.days
      ? new Date(new Date(`${dates}T12:00:00`).getTime() + (inferred.days - 1) * 86_400_000).toISOString().slice(0, 10)
      : endDate;
    setOrigin(requestOrigin);
    setDestination(requestDestination);
    setTravelers(String(requestTravelers));
    setBudget(String(requestBudget));
    if (inferred.days) setEndDate(requestEndDate);
    setRunning(true);
    setDone(false);
    setError("");
    const next = preview.map((s) => ({ ...s }));
    setSteps(next);
    setMarkers(0);
    for (let i = 0; i < next.length; i += 1) {
      setSteps((curr) => curr.map((s, idx) => ({ ...s, status: idx < i ? "done" : idx === i ? "active" : "pending" })));
      setMarkers((m) => Math.min(6, m + 1));
      await wait(520);
    }
    setSteps((curr) => curr.map((s) => ({ ...s, status: "done" })));
    try {
      const trip = await travelAgent.createTrip({
        prompt,
        origin: requestOrigin,
        destination: requestDestination,
        startDate: dates,
        endDate: requestEndDate,
        travelers: requestTravelers,
        budget: requestBudget,
        vibes,
        includeExternalOffers: includeOffers,
      });
      hydrateTrip(trip);
      setDone(true);
      await wait(700);
      router.push(`/trip/${encodeURIComponent(trip.id)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.startsWith("NO_PROVIDER_CONFIGURED")
        ? "尚未配置高德服务端 Key。请设置 AMAP_SERVER_KEY 后再创建真实行程。"
        : message.startsWith("AMAP_INVALID_USER_KEY")
          ? "高德 Web 服务 Key 无效或未开通 POI 服务，请检查控制台的 Key 类型、服务权限和安全设置。"
          : message.startsWith("ROUTE_PROVIDER_UNAVAILABLE")
            ? "高德路线服务暂时不可用；可重试，行程中的路线会明确标记为估算。"
            : message || "行程创建失败，请检查真实数据服务后重试。");
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-16">
      <p className="text-[13px] text-muted-foreground">{brand.name}</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight text-balance">去哪旅行？</h1>
      <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
        告诉我你想去哪里、玩几天、和谁一起、预算和喜好。我会生成一份能走的行程，而不是一篇攻略。
      </p>

      <div className="mt-8 rounded-[14px] border border-border bg-surface p-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-28 border-0 bg-transparent px-2 text-[15px] shadow-none focus-visible:ring-0"
          placeholder="告诉我你想去哪里、玩几天、和谁一起、预算和喜好……"
        />
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {CHIPS.map((chip) => {
            const on = vibes.includes(chip);
            return (
              <button
                key={chip}
                type="button"
                onClick={() => setVibes((v) => (on ? v.filter((x) => x !== chip) : [...v, chip]))}
                className={`rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}
              >
                {chip}
              </button>
            );
          })}
        </div>
        <button type="button" className="px-2 text-[12px] text-muted-foreground" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "收起结构化字段" : "展开出发地 / 日期 / 人数"}
        </button>
        {advanced ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="出发地" />
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="目的地" />
            <Input type="date" value={dates} onChange={(e) => setDates(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Input value={travelers} onChange={(e) => setTravelers(e.target.value)} placeholder="人数" />
            <Input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="预算" className="sm:col-span-2" />
          </div>
        ) : null}
        <div className="mt-3 flex justify-end">
          <label className="mr-auto flex items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={includeOffers} onChange={(e) => setIncludeOffers(e.target.checked)} />
            同步酒店 / 交通 / 门票 / 美食推荐
          </label>
          <Button size="lg" disabled={running} onClick={() => void run()}>
            AI 创建旅行
          </Button>
        </div>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {running ? (
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <ul className="space-y-2.5">
            <p className="text-sm font-medium">正在研究{destination}……</p>
            {steps.map((step) => (
              <li key={step.id} className="flex items-center gap-2 text-sm">
                <span className="grid size-4 place-items-center text-[12px]">
                  {step.status === "done" ? "✓" : step.status === "active" ? "●" : "○"}
                </span>
                <span className={step.status === "pending" ? "text-muted-foreground" : ""}>{step.label}</span>
              </li>
            ))}
            {done ? <p className="pt-2 text-sm font-medium">旅行准备好了</p> : null}
          </ul>
          <div className="relative h-56 overflow-hidden rounded-[14px] bg-[var(--map-land)] map-dots">
            {Array.from({ length: markers }).map((_, i) => (
              <motion.span
                key={i}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute size-3 rounded-full bg-primary"
                style={{ left: `${18 + i * 12}%`, top: `${28 + (i % 3) * 16}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
