"use client";

import { useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, ClipboardPaste, ExternalLink, LoaderCircle, MapPin, Search, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPlaceToTrip, importRouteToTrip, TripCommandError } from "@/services/trip-commands";
import { optimizeGuideDayAssignment } from "@/services/itinerary-optimizer";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { GuideCandidate, GuideCategory, GuidePost } from "@/services/planning/guide-extract";
import type { Place } from "@/types/travel";

interface ParsedGuide {
  extractionSource: "llm" | "rules";
  candidates: GuideCandidate[];
  resolvedCount: number;
  warnings?: string[];
}

const CATEGORIES: Array<{ id: GuideCategory; label: string; query: string; placeholder: string }> = [
  { id: "route", label: "精选路线", query: "旅游攻略 路线", placeholder: "例如：一日游、经典路线" },
  { id: "food", label: "必吃美食", query: "美食攻略 必吃 餐厅", placeholder: "例如：老字号、火锅、早茶、特色小吃" },
  { id: "latest", label: "最新笔记", query: "旅游 攻略 笔记", placeholder: "输入关键词查找最新游记" },
  { id: "custom", label: "自定义搜索", query: "", placeholder: "输入任意小红书搜索词…" },
];

function postDate(post: GuidePost) {
  if (post.platform === "pasted") return "手动粘贴";
  const timestamp = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("zh-CN") : "日期未知";
}

export interface XhsGuidePanelProps {
  city: string;
  defaultCategory?: GuideCategory;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * 攻略导入 → 真实行程与地图。
 * 在线检索当前来自小红书公开笔记；抖音/微信/任意平台的攻略可直接粘贴原文。
 * 抽取的地点名称由高德逐个核实，找到的真实 POI 可一键定位地图、加入某天，
 * 或整条路线一键导入并自动生成打卡任务清单。
 */
export function XhsGuidePanel({
  city,
  defaultCategory = "route",
  title = "攻略导入 · 小红书 / 抖音 / 微信",
  description = "在线搜索小红书爆款笔记，或直接粘贴任意平台的攻略原文——解析成真实地点后一键生成路线与打卡清单；地点由高德核实，找不到的不编造。",
  className,
}: XhsGuidePanelProps) {
  const trip = useTripStore((s) => s.trip);
  const setTrip = useTripStore((s) => s.setTrip);
  const patch = useTripStore((s) => s.patchTrip);
  const selectPlace = useUiStore((s) => s.selectPlace);

  const [category, setCategory] = useState<GuideCategory>(defaultCategory);
  const [customQuery, setCustomQuery] = useState("");
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
  const [importingRoute, setImportingRoute] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  /** Synthetic source id for guides pasted from 抖音/微信/任何平台. */
  const PASTE_SOURCE_ID = "pasted-guide";

  const activeCategoryDef = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  const load = async (cat = category, custom = customQuery) => {
    setPhase("loading");
    setError("");
    const catDef = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0];
    const query = cat === "custom" ? custom.trim() || "旅游攻略" : catDef.query;
    try {
      const response = await fetch("/api/voyage/social/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city, query, category: cat }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        data?: { posts?: GuidePost[]; platformStatus?: Record<string, string> };
        warnings?: string[];
        error?: { message?: string };
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "小红书攻略获取失败");
      setPosts(payload.data?.posts ?? []);
      const xhs = payload.data?.platformStatus?.xiaohongshu;
      setStatus(
        xhs === "ok"
          ? `已从小红书获取「${catDef.label}」公开笔记`
          : xhs === "error"
            ? "小红书查询失败（上游不可用），稍后可重试"
            : "小红书数据源未配置或无结果",
      );
      setWarnings(payload.warnings ?? []);
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "小红书攻略获取失败");
      setPhase("done");
    }
  };

  const switchCategory = (cat: GuideCategory) => {
    setCategory(cat);
    if (phase !== "idle") {
      void load(cat, customQuery);
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
      const payload = await response.json() as { ok?: boolean; data?: ParsedGuide; warnings?: string[]; error?: { message?: string } };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error?.message ?? "地点解析失败");
      // Degradation reasons (LLM fallback, QPS throttling) are part of the
      // honest chain — show them next to the candidates instead of dropping.
      setParsed((current) => ({ ...current, [post.sourceId]: { ...payload.data!, warnings: payload.warnings ?? [] } }));
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

  /**
   * Location is written through the runtime so the marker survives a reload;
   * a local-store patch alone is wiped by the next server rehydrate.
   */
  const locateOnMap = (place: Place) => {
    const alreadyOnTrip = trip.places.some((p) => p.id === place.id);
    if (!alreadyOnTrip) patch((t) => ({ ...t, places: [...t.places, place] }));
    selectPlace(place.id);
    if (alreadyOnTrip) {
      toast.success(`已在地图高亮定位：${place.name}`);
      return;
    }
    void addPlaceToTrip({ tripId: trip.id, place, expectedTripRevision: useTripStore.getState().revision })
      .then(({ trip: saved, revision }) => {
        setTrip(saved, revision);
        toast.success(`已在地图高亮定位：${place.name}`);
      })
      .catch((error) => toast.error(error instanceof TripCommandError ? error.message : "地图定位保存失败，请重试"));
  };

  const addSelected = async (post: GuidePost) => {
    const selection = parsed[post.sourceId];
    if (!selection || adding) return;
    const pickedPlaces = selection.candidates.filter(
      (candidate) => candidate.resolved && candidate.place && checked[post.sourceId]?.has(candidate.name),
    ).map((candidate) => candidate.place!);
    if (!pickedPlaces.length) {
      toast.error("请先勾选至少一个地点");
      return;
    }
    const targetDayId = dayId || trip.days[0]?.id;
    if (!targetDayId) {
      toast.error("行程里还没有可加入的日期");
      return;
    }
    setAdding(true);
    try {
      // One server transaction for the whole selection: atomic, revision-locked,
      // and each stop gets a check-in task in the same write.
      const result = await importRouteToTrip({
        tripId: trip.id,
        assignments: [{ dayId: targetDayId, places: pickedPlaces }],
        expectedTripRevision: useTripStore.getState().revision,
      });
      setTrip(result.trip, result.revision);
      setAddedNames((current) => ({
        ...current,
        [post.sourceId]: [...(current[post.sourceId] ?? []), ...selection.candidates.filter((c) => c.resolved && c.place).map((c) => c.name)],
      }));
      const dayLabel = `Day ${trip.days.findIndex((day) => day.id === targetDayId) + 1}`;
      toast.success(`已加入 ${result.importedCount} 个地点到 ${dayLabel}，地图已连线，打卡任务已生成`);
    } catch (error) {
      toast.error(error instanceof TripCommandError ? error.message : "加入失败，请重试");
    } finally {
      setAdding(false);
    }
  };

  /**
   * One-click route generation: every resolved place, in the guide's original
   * order, spread evenly across the trip's days. The runtime recomputes each
   * affected day, so the map draws the line immediately, and a check-in task
   * list appears alongside.
   */
  const importRouteAll = async (post: GuidePost) => {
    const selection = parsed[post.sourceId];
    if (!selection || importingRoute) return;
    const places = selection.candidates.filter((candidate) => candidate.resolved && candidate.place).map((candidate) => candidate.place!);
    if (!places.length) {
      toast.error("没有已解析成功的地点可以导入");
      return;
    }
    if (places.length > 20) {
      toast.error("一次最多导入 20 个地点，请取消勾选部分后再试");
      return;
    }
    if (!trip.days.length) {
      toast.error("行程里还没有可分配的日期");
      return;
    }
    setImportingRoute(true);
    try {
      // The itinerary optimizer clusters places geographically, respects time
      // windows (night views late, meals at meal times), and applies the
      // trip's planning profile; the guide's original order stays a signal.
      const optimization = optimizeGuideDayAssignment({
        places,
        days: trip.days.map((day) => ({ dayId: day.id, date: day.date, weather: { condition: day.weather?.condition, icon: day.weather?.icon } })),
        profile: trip.planningMetadata?.planningProfile ?? null,
        hotel: trip.places.find((candidate) => candidate.category === "hotel") ?? null,
      });
      const assignments = optimization.assignments
        .map((assignment) => ({ dayId: assignment.dayId, places: assignment.places }))
        .filter((assignment) => assignment.places.length > 0);
      const result = await importRouteToTrip({
        tripId: trip.id,
        assignments,
        expectedTripRevision: useTripStore.getState().revision,
      });
      setTrip(result.trip, result.revision);
      setAddedNames((current) => ({
        ...current,
        [post.sourceId]: [...(current[post.sourceId] ?? []), ...selection.candidates.filter((c) => c.resolved && c.place).map((c) => c.name)],
      }));
      const scheduleNote = optimization.decisions[0]?.reason;
      toast.success(`已导入 ${result.importedCount} 个地点并智能排程，打卡任务清单已生成${scheduleNote ? `。${scheduleNote}` : ""}`);
    } catch (error) {
      toast.error(error instanceof TripCommandError ? error.message : "路线导入失败，请重试");
    } finally {
      setImportingRoute(false);
    }
  };

  /** Paste entry: 抖音/微信/任何平台的攻略文本都走同一个抽取器。 */
  const parsePasted = async () => {
    const text = pasteText.trim();
    if (text.length < 10) {
      toast.error("攻略文本太短（至少 10 字）");
      return;
    }
    const pastedPost: GuidePost = {
      platform: "pasted",
      sourceId: PASTE_SOURCE_ID,
      summary: text.slice(0, 60),
      content: text.slice(0, 4000),
      fetchedAt: new Date().toISOString(),
      metrics: {},
    };
    setOpenPostId(PASTE_SOURCE_ID);
    if (!posts.some((post) => post.sourceId === PASTE_SOURCE_ID)) {
      setPosts((current) => [pastedPost, ...current]);
    }
    await parse(pastedPost);
  };

  return (
    <section className={cn("rounded-[16px] border border-border bg-surface p-4", className)} aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#ff2442]/10 text-[#ff2442]">
              <BookOpen className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="text-[11px] text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
        <Button size="sm" onClick={() => void load()} disabled={phase === "loading"}>
          {phase === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {phase === "done" ? "重新获取" : "获取攻略"}
        </Button>
      </div>

      {/* Category selector */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-2.5">
        {CATEGORIES.map((c) => {
          const active = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => switchCategory(c.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {category === "custom" ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load("custom", customQuery);
          }}
        >
          <Input
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            placeholder={activeCategoryDef.placeholder}
            className="h-8 text-xs"
          />
          <Button size="sm" type="submit" disabled={phase === "loading" || !customQuery.trim()}>
            <Search className="size-3.5 mr-1" />
            搜索
          </Button>
        </form>
      ) : null}

      {status ? <p className="mt-3 text-[11px] text-muted-foreground">{status}</p> : null}
      {error ? <p role="alert" className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-800">{error}</p> : null}
      {warnings.length ? <p className="mt-2 text-[11px] text-amber-700">{warnings.slice(0, 2).join("；")}</p> : null}

      {/* Paste entry: 小红书/抖音/微信/任意平台的攻略文本都走同一个抽取器。 */}
      <div className="mt-3 rounded-[12px] border border-dashed border-border bg-background/50">
        <button
          type="button"
          onClick={() => setPasteOpen((open) => !open)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={pasteOpen}
        >
          <ClipboardPaste className="size-3.5 text-primary" />
          粘贴攻略文本（抖音 / 微信 / 小红书 / 任何平台）
        </button>
        {pasteOpen ? (
          <div className="px-3 pb-3">
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="把刷到的攻略原文粘进来：行程顺序、地点名、天数都行——例如「Day1 洪崖洞→十八梯→长江索道，Day2 磁器口…」"
              className="min-h-28 w-full resize-y rounded-[10px] border border-border bg-surface p-2.5 text-[12px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              aria-label="粘贴攻略原文"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">按原文顺序抽取地点，由高德逐个核实；找不到的不编造。</p>
              <Button size="sm" disabled={parsing === PASTE_SOURCE_ID || pasteText.trim().length < 10} onClick={() => void parsePasted()}>
                {parsing === PASTE_SOURCE_ID ? <LoaderCircle className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
                解析地点
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {phase === "done" && posts.length === 0 && !error ? (
        <p className="mt-3 text-[11px] text-muted-foreground">没有找到适合解析的小红书笔记。可以换个关键词重试，或直接粘贴攻略文本。</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {posts.map((post) => {
          const selection = parsed[post.sourceId];
          const open = openPostId === post.sourceId;
          const added = addedNames[post.sourceId] ?? [];
          return (
            <article key={post.sourceId} className="rounded-[12px] border border-border bg-background/50">
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
                onClick={() => (open ? setOpenPostId(null) : void parse(post))}
              >
                <span className="mt-0.5 text-muted-foreground">
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium leading-5 text-foreground line-clamp-2">{post.summary}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {post.platform === "pasted" ? "粘贴的攻略" : "小红书"} · {postDate(post)} · {Object.entries(post.metrics).filter(([, v]) => typeof v === "number").slice(0, 2).map(([k, v]) => `${k} ${v}`).join(" · ") || "公开笔记"}
                    {post.sourceUrl ? " · " : ""}
                    {post.sourceUrl ? (
                      <a
                        href={post.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline inline-flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        原文{post.sourceUrlKind === "derived" ? "（由来源 ID 推导）" : ""}
                        <ExternalLink className="size-2.5" />
                      </a>
                    ) : null}
                  </span>
                </span>
                {parsing === post.sourceId ? (
                  <LoaderCircle className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
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
                      {selection!.warnings?.length ? <p className="mt-1 text-[11px] text-amber-700">{selection!.warnings.slice(0, 2).join("；")}</p> : null}
                      <div className="mt-2 space-y-2">
                        {selection!.candidates.map((candidate) => {
                          const isChecked = checked[post.sourceId]?.has(candidate.name) ?? false;
                          const isAdded = added.includes(candidate.name);
                          return (
                            <div key={candidate.name} className="flex items-start justify-between gap-2 text-[11px] rounded-lg p-1.5 hover:bg-secondary/40">
                              {candidate.resolved && candidate.place ? (
                                <label className="flex min-w-0 cursor-pointer items-start gap-2 flex-1">
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
                                      {candidate.place.rating ? ` · ${candidate.place.rating.toFixed(1)}分` : ""}
                                      {" "}· {candidate.matchBasis === "exact" ? "完全一致" : "名称包含"}
                                    </span>
                                  </span>
                                </label>
                              ) : (
                                <span className="min-w-0 text-muted-foreground flex-1">
                                  <span className="line-through">{candidate.name}</span> · 未在数据源找到，未加入
                                </span>
                              )}

                              {candidate.resolved && candidate.place ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => locateOnMap(candidate.place!)}
                                    className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border/80 bg-surface"
                                  >
                                    <MapPin className="size-3 text-primary" />
                                    地图定位
                                  </button>
                                  {isAdded ? (
                                    <span className="inline-flex items-center gap-0.5 text-primary text-[10px]">
                                      <Check className="size-3" />
                                      已加入
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-2.5">
                        <select
                          value={dayId}
                          onChange={(e) => setDayId(e.target.value)}
                          className="h-8 rounded-[10px] border border-input bg-surface px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="加入哪一天"
                        >
                          {trip.days.map((day) => (
                            <option key={day.id} value={day.id}>
                              Day {day.index + 1} · {day.date.slice(5)}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={adding || !checked[post.sourceId]?.size}
                          onClick={() => void addSelected(post)}
                        >
                          {adding ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                          加入所选地点
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 border-primary/40 text-primary"
                          disabled={importingRoute || adding}
                          onClick={() => void importRouteAll(post)}
                          title="把解析出的全部地点按攻略原文顺序自动分配到各天，生成路线与打卡清单"
                        >
                          {importingRoute ? <LoaderCircle className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
                          一键生成路线图
                        </Button>
                      </div>
                      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                        「加入所选地点」保存到选定日期；「一键生成路线图」按攻略原文顺序分配到各天并生成打卡清单。
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
