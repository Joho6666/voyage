"use client";

import { useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, ExternalLink, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addPlaceItemToDay, TripCommandError } from "@/services/trip-commands";
import { useTripStore } from "@/store/trip-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { GuideCandidate, GuidePost } from "@/services/planning/guide-extract";

interface ParsedGuide {
  extractionSource: "llm" | "rules";
  candidates: GuideCandidate[];
  resolvedCount: number;
}

function postDate(post: GuidePost) {
  const timestamp = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("zh-CN") : "日期未知";
}

/**
 * 小红书爆款攻略 → 真实行程。Posts are free-text hints: candidate names are
 * extracted from the text, then each one must resolve to a real AMap POI.
 * Unresolved names are shown as failures — never replaced with invented stops.
 */
export function XhsGuidePanel({ city }: { city: string }) {
  const trip = useTripStore((s) => s.trip);
  const setTrip = useTripStore((s) => s.setTrip);

  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [posts, setPosts] = useState<GuidePost[]>([]);
  const [status, setStatus] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [parsing, setParsing] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Record<string, ParsedGuide>>({});
  const [checked, setChecked] = useState<Record<string, Set<string>>>({});
  const [addedNames, setAddedNames] = useState<Record<string, string[]>>({});
  const [dayId, setDayId] = useState(trip.days[0]?.id ?? "");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setPhase("loading");
    setError("");
    try {
      const response = await fetch("/api/voyage/social/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city }),
      });
      const payload = await response.json() as { ok?: boolean; data?: { posts?: GuidePost[]; platformStatus?: Record<string, string> }; warnings?: string[]; error?: { message?: string } };
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "小红书攻略获取失败");
      setPosts(payload.data?.posts ?? []);
      const xhs = payload.data?.platformStatus?.xiaohongshu;
      setStatus(xhs === "ok" ? "已从小红书获取公开攻略" : xhs === "error" ? "小红书查询失败（上游不可用），稍后可重试" : "小红书数据源未配置或无结果");
      setWarnings(payload.warnings ?? []);
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "小红书攻略获取失败");
      setPhase("done");
    }
  };

  const parse = async (post: GuidePost) => {
    setOpenPostId(post.sourceId);
    if (parsed[post.sourceId]) return;
    setParsing(post.sourceId);
    try {
      const response = await fetch("/api/voyage/social/extract-places", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city, text: post.content }),
      });
      const payload = await response.json() as { ok?: boolean; data?: ParsedGuide; error?: { message?: string } };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error?.message ?? "地点解析失败");
      setParsed((current) => ({ ...current, [post.sourceId]: payload.data! }));
      setChecked((current) => ({
        ...current,
        [post.sourceId]: new Set(payload.data!.candidates.filter((candidate) => candidate.resolved).map((candidate) => candidate.name)),
      }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "地点解析失败");
      setOpenPostId(null);
    } finally {
      setParsing(null);
    }
  };

  const toggle = (sourceId: string, name: string) => {
    setChecked((current) => {
      const next = new Set(current[sourceId] ?? []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...current, [sourceId]: next };
    });
  };

  const addSelected = async (post: GuidePost) => {
    const selection = parsed[post.sourceId];
    if (!selection || adding) return;
    const picked = selection.candidates.filter((candidate) => candidate.resolved && candidate.place && checked[post.sourceId]?.has(candidate.name));
    if (!picked.length) { toast.error("请先勾选至少一个地点"); return; }
    const targetDayId = dayId || trip.days[0]?.id;
    if (!targetDayId) { toast.error("行程里还没有可加入的日期"); return; }
    setAdding(true);
    let added = 0;
    const failed: string[] = [];
    for (const candidate of picked) {
      try {
        // Read the revision from the store each round: every successful add
        // bumps it, so a captured value would conflict from the second item on.
        const { revision } = useTripStore.getState();
        const result = await addPlaceItemToDay({ tripId: trip.id, place: candidate.place!, dayId: targetDayId, expectedTripRevision: revision });
        setTrip(result.trip, result.revision);
        added += 1;
      } catch (error) {
        failed.push(`${candidate.name}：${error instanceof TripCommandError ? error.message : "加入失败"}`);
      }
    }
    setAdding(false);
    if (added) {
      setAddedNames((current) => ({ ...current, [post.sourceId]: [...(current[post.sourceId] ?? []), ...picked.filter((candidate) => !failed.some((entry) => entry.startsWith(`${candidate.name}：`))).map((candidate) => candidate.name)] }));
      const dayLabel = `Day ${trip.days.findIndex((day) => day.id === targetDayId) + 1}`;
      toast.success(`已加入 ${added} 个地点到 ${dayLabel}${failed.length ? `；${failed.length} 个失败` : ""}`);
    }
    if (failed.length) toast.error(failed.join("；"));
  };

  return (
    <section className="rounded-[16px] border border-border bg-surface p-4" aria-label="小红书爆款攻略">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#ff2442]/10 text-[#ff2442]"><BookOpen className="size-4" /></span>
            <div>
              <h2 className="text-sm font-semibold">小红书爆款攻略</h2>
              <p className="text-[11px] text-muted-foreground">选一篇攻略，解析成真实地点后一键加入行程；地点由高德核实，找不到的不编造。</p>
            </div>
          </div>
        </div>
        {phase === "done" ? (
          <Button size="sm" variant="outline" onClick={() => void load()}>重新获取</Button>
        ) : (
          <Button size="sm" onClick={() => void load()} disabled={phase === "loading"}>
            {phase === "loading" ? <LoaderCircle className="animate-spin" /> : <Sparkles className="size-3.5" />}
            获取攻略
          </Button>
        )}
      </div>

      {status ? <p className="mt-3 text-[11px] text-muted-foreground">{status}</p> : null}
      {error ? <p role="alert" className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-800">{error}</p> : null}
      {warnings.length ? <p className="mt-2 text-[11px] text-amber-700">{warnings.slice(0, 2).join("；")}</p> : null}

      {phase === "done" && posts.length === 0 && !error ? (
        <p className="mt-3 text-[11px] text-muted-foreground">没有找到适合解析的攻略帖子。可以换个说法重试，或直接在下方搜索地点。</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {posts.map((post) => {
          const selection = parsed[post.sourceId];
          const open = openPostId === post.sourceId;
          const added = addedNames[post.sourceId] ?? [];
          return (
            <article key={post.sourceId} className="rounded-[12px] border border-border bg-background/50">
              <button type="button" className="flex w-full items-start gap-2 px-3 py-2.5 text-left" onClick={() => (open ? setOpenPostId(null) : void parse(post))}>
                <span className="mt-0.5 text-muted-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium leading-5 text-foreground line-clamp-2">{post.summary}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    小红书 · {postDate(post)} · {Object.entries(post.metrics).filter(([, value]) => typeof value === "number").slice(0, 2).map(([key, value]) => `${key} ${value}`).join(" · ") || "无互动数据"}
                    {post.sourceUrl ? " · " : ""}
                    {post.sourceUrl ? <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline" onClick={(event) => event.stopPropagation()}>原文{post.sourceUrlKind === "derived" ? "（由来源 ID 推导）" : ""}<ExternalLink className="ml-0.5 inline size-2.5" /></a> : null}
                  </span>
                </span>
                {parsing === post.sourceId ? <LoaderCircle className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
              </button>

              {open && post.sourceId in parsed ? (
                <div className="border-t border-border/70 px-3 py-2.5">
                  {selection!.candidates.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">这篇内容里没有抽取出可解析的地点名称。</p>
                  ) : (
                    <>
                      <p className="text-[10px] text-muted-foreground">
                        候选地点由{selection!.extractionSource === "llm" ? "模型从原文抽取" : "规则从原文抽取"}，再经高德逐个核实：
                        {selection!.resolvedCount}/{selection!.candidates.length} 个找到真实地点。
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {selection!.candidates.map((candidate) => {
                          const isChecked = checked[post.sourceId]?.has(candidate.name) ?? false;
                          const isAdded = added.includes(candidate.name);
                          return (
                            <div key={candidate.name} className="flex items-start justify-between gap-2 text-[11px]">
                              {candidate.resolved && candidate.place ? (
                                <label className="flex min-w-0 cursor-pointer items-start gap-2">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 size-3.5 accent-[var(--primary)]"
                                    checked={isChecked && !isAdded}
                                    disabled={isAdded}
                                    onChange={() => toggle(post.sourceId, candidate.name)}
                                  />
                                  <span className="min-w-0">
                                    <span className="font-medium text-foreground">{candidate.place.name}</span>
                                    <span className="text-muted-foreground">
                                      {" "}· {candidate.place.district || candidate.place.address}
                                      {candidate.place.rating ? ` · ${candidate.place.rating.toFixed(1)} 分` : ""}
                                      {" "}· 匹配方式 {candidate.matchBasis === "exact" ? "完全一致" : "名称包含"}
                                    </span>
                                  </span>
                                </label>
                              ) : (
                                <span className="min-w-0 text-muted-foreground">
                                  <span className="line-through">{candidate.name}</span> · 未在数据源找到，未加入
                                </span>
                              )}
                              {isAdded ? <span className="inline-flex shrink-0 items-center gap-0.5 text-primary"><Check className="size-3" />已加入</span> : null}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <select
                          value={dayId}
                          onChange={(event) => setDayId(event.target.value)}
                          className="h-8 rounded-[10px] border border-input bg-surface px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="加入哪一天"
                        >
                          {trip.days.map((day) => <option key={day.id} value={day.id}>Day {day.index + 1} · {day.date.slice(5)}</option>)}
                        </select>
                        <Button size="sm" className="gap-1" disabled={adding || !checked[post.sourceId]?.size} onClick={() => void addSelected(post)}>
                          {adding ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                          加入所选地点
                        </Button>
                      </div>
                      <p className={cn("mt-2 text-[10px] leading-4 text-muted-foreground")}>
                        每个地点都会经高德坐标核验并按 revision 锁保存，刷新后不会丢失。
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
