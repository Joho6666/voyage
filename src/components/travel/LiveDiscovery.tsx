"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TravelImage } from "@/components/travel/TravelImage";

type Kind = "hotel" | "food" | "activity";
type Result = { id: string; name: string; address: string; lat: number; lng: number; image?: string; rating?: number; reviewCount?: number; cost?: number; score: number; insight: string; sourceId?: string; fetchedAt: string };

export function LiveDiscovery({ city, kind, query, title }: { city: string; kind: Kind; query: string; title: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!city) return;
    let active = true;
    setStatus("loading");
    const request = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch("/api/voyage/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city, kind, query, limit: 12 }), signal: AbortSignal.timeout(20_000) });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.ok) throw new Error(payload.warning || payload.error || `实时查询失败（${response.status}）`);
          return payload as { results: Result[]; warning?: string };
        } catch (error) {
          lastError = error;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("实时查询暂时不可用");
    };
    request()
      .then((payload) => { if (!active) return; setResults(payload.results); setMessage(payload.warning || ""); setStatus("ready"); })
      .catch((error) => { if (!active) return; setStatus("error"); setMessage(error instanceof Error && error.name === "TimeoutError" ? "高德实时查询超时，请点击刷新重试。" : "高德实时查询暂时不可用，请点击刷新重试。 "); })
    return () => { active = false; };
  }, [city, kind, query, reload]);

  return <section className="mt-5 rounded-[16px] border border-primary/20 bg-primary/[0.03] p-3.5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-[11px] text-muted-foreground">高德实时 POI 发现 · 按评分、评价量和人均消费生成参考排序</p></div><Button size="sm" variant="outline" onClick={() => setReload((v) => v + 1)} disabled={status === "loading"}><RefreshCw className={`mr-1 size-3 ${status === "loading" ? "animate-spin" : ""}`} />刷新</Button></div>
    {message ? <p className="mt-2 text-[11px] text-muted-foreground">{message}</p> : null}
    {status === "loading" ? <p className="mt-4 text-center text-xs text-muted-foreground">正在搜索 {city}…</p> : null}
    {status === "error" ? <div className="mt-4 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground"><p>{message}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => setReload((v) => v + 1)}>重新查询</Button></div> : null}
    {status === "ready" && results.length === 0 ? <p className="mt-4 rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">没有找到匹配结果，试试更换关键词。</p> : null}
    <div className="mt-3 space-y-3">{results.map((result) => <article key={result.id} className="overflow-hidden rounded-xl border border-border bg-surface sm:flex">
      {result.image ? <TravelImage src={result.image} alt={result.name} className="h-32 w-full object-cover sm:h-auto sm:w-36" /> : null}
      <div className="min-w-0 flex-1 p-3"><div className="flex items-start justify-between gap-2"><div><div className="mb-1 flex flex-wrap gap-1"><Badge variant="outline" className="text-[10px]">高德 POI</Badge><Badge variant="outline" className="text-[10px]">参考分 {result.score}</Badge></div><h3 className="text-sm font-semibold">{result.name}</h3></div><a className="text-muted-foreground" href={`https://uri.amap.com/marker?position=${result.lng},${result.lat}&name=${encodeURIComponent(result.name)}`} target="_blank" rel="noreferrer" aria-label="在高德查看"><ExternalLink className="size-4" /></a></div>
        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{result.address || "地址未返回"}</p><div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1 text-amber-600"><Star className="size-3 fill-current" />{result.rating?.toFixed(1) ?? "暂无评分"}</span><span>{result.reviewCount ? `${result.reviewCount.toLocaleString()} 条评价` : "评价数未知"}</span><span>{result.cost ? `人均 ¥${result.cost}` : "人均未知"}</span></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{result.insight}</p></div>
    </article>)}</div>
  </section>;
}
