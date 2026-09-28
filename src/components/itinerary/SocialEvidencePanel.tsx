"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SocialEvidence } from "@/services/social/types";
import type { Trip } from "@/types/travel";
import { cn } from "@/lib/utils";

type PlatformStatus = NonNullable<Trip["socialPlatformStatus"]>[string];
type QueryStatus = NonNullable<Trip["socialQueryStatus"]>;

const LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  weibo: "微博",
  wechat_search: "微信搜一搜",
};

const PROVIDER_LABELS: Record<string, string> = {
  tikhub: "TikHub",
  redfox: "RedFox",
};

const STATUS_LABELS: Record<PlatformStatus | QueryStatus, string> = {
  ok: "查询成功",
  unavailable: "未配置或无结果",
  error: "查询失败",
  not_requested: "未请求",
  used: "已用于规划参考",
  queried_not_used: "已查询，未用于排序",
};

function dateLabel(value?: string) {
  if (!value) return "未知";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN") : "未知";
}

/** The upstream reason for a failing platform, if the trip recorded one. */
function platformFailureReason(platform: string, warnings: string[]) {
  const match = warnings.find((warning) => warning.startsWith(`${platform}:`));
  if (!match) return undefined;
  return match.slice(platform.length + 1).trim().slice(0, 80);
}

/** Count per platform, so the collapsed summary can say what was actually read. */
function coverageSummary(evidence: SocialEvidence[]) {
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.platform, (counts.get(item.platform) ?? 0) + 1);
  return [...counts.entries()]
    .map(([platform, count]) => `${LABELS[platform] ?? platform} ${count} 篇`)
    .join(" · ");
}

export function SocialEvidencePanel({
  evidence,
  warnings,
  platformStatus,
  queryStatus,
  planningMetadata,
}: {
  evidence?: SocialEvidence[];
  warnings?: string[];
  platformStatus?: Record<string, PlatformStatus>;
  queryStatus?: QueryStatus;
  planningMetadata?: Trip["planningMetadata"];
}) {
  // Collapsed by default: the workspace should lead with the itinerary, and the
  // full provenance stays one click away rather than always on screen.
  const [open, setOpen] = useState(false);
  if (!evidence?.length && !warnings?.length && !platformStatus && !queryStatus && !planningMetadata) return null;

  const statuses = Object.entries(platformStatus ?? {});
  const failed = statuses.filter(([, status]) => status === "error");
  const items = evidence ?? [];
  const planningLine = planningMetadata
    ? planningMetadata.llm === "used"
      ? "LLM 仅在真实候选地点中选择与排序"
      : planningMetadata.llm === "failed"
        ? `LLM 调用失败，已降级为规则规划${planningMetadata.fallbackReason ? `（${planningMetadata.fallbackReason}）` : ""}`
        : planningMetadata.llm === "unavailable"
          ? "未配置 LLM，使用规则规划"
          : "本次未调用外部 LLM，使用规则规划"
    : "";

  return (
    <section className="border-b border-border" aria-label="本次规划来源">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
      >
        <span className="mt-0.5 text-muted-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">本次规划来源</span>
            {planningMetadata ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {planningMetadata.source === "llm" ? "LLM 辅助排序" : "确定性规则规划"}
              </span>
            ) : null}
            {queryStatus ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABELS[queryStatus]}</span> : null}
          </span>
          <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
            {items.length ? `已读取 ${coverageSummary(items)}` : "本次没有可核对的攻略证据"}
            {failed.length ? ` · ${failed.map(([platform]) => `${LABELS[platform] ?? platform}查询失败`).join("、")}` : ""}
          </span>
          {planningLine && planningMetadata?.source !== "llm" ? (
            <span className="mt-0.5 block text-[11px] leading-4 text-amber-700">{planningLine}</span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 px-4 pb-4">
          {planningMetadata ? (
            <div className="rounded-lg border border-border bg-background/60 p-3 text-xs">
              <p className="text-muted-foreground">
                {planningMetadata.llm === "used"
                  ? "模型仅在真实 provider 候选地点中选择与排序，没有创建地点、价格或库存。"
                  : planningMetadata.llm === "failed"
                    ? "LLM 调用失败，本次已自动降级为规则规划。"
                    : planningMetadata.llm === "unavailable"
                      ? "未配置 LLM，本次使用规则规划。"
                      : "本次未调用外部 LLM，使用规则规划。"}
              </p>
              {planningMetadata.fallbackReason ? <p className="mt-1 text-amber-700">降级原因：{planningMetadata.fallbackReason}</p> : null}
            </div>
          ) : null}

          <div>
            <h2 className="text-sm font-semibold">联网攻略参考</h2>
            <p className="mt-1 text-xs text-muted-foreground">平台内容仅供参考；地点、天气、路线与报价以实时供应商数据为准。</p>
          </div>

          {statuses.length ? (
            <div className="flex flex-wrap gap-1.5" aria-label="社交平台查询状态">
              {statuses.map(([platform, status]) => {
                const reason = status === "error" ? platformFailureReason(platform, warnings ?? []) : undefined;
                return (
                  <span
                    key={platform}
                    className={cn(
                      "rounded-full border px-2 py-1 text-[11px]",
                      status === "ok" ? "border-emerald-500/30 text-emerald-700" : status === "error" ? "border-rose-500/30 text-rose-700" : "border-border text-muted-foreground",
                    )}
                    title={reason ? `上游返回：${reason}` : undefined}
                  >
                    {LABELS[platform] ?? platform} · {STATUS_LABELS[status]}
                    {reason ? <span className="text-rose-700/80">（{reason}）</span> : null}
                  </span>
                );
              })}
            </div>
          ) : null}

          {items.length ? (
            <div className="space-y-2">
              {items.slice(0, 8).map((item) => (
                <article key={`${item.provider ?? "unknown"}-${item.platform}-${item.sourceId}`} className="rounded-lg border border-border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{LABELS[item.platform] ?? item.platform}</strong>
                    <span className="text-muted-foreground">{item.provider ? PROVIDER_LABELS[item.provider] ?? item.provider : "来源 provider 未记录"} · 置信度 {Math.round(item.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1 line-clamp-3">{item.summary}</p>
                  <p className="mt-2 text-muted-foreground">
                    {item.publishedAt ? `发布 ${dateLabel(item.publishedAt)} · ` : "发布时间未知 · "}
                    抓取 {dateLabel(item.fetchedAt)} ·
                    {item.expiresAt ? ` 有效至 ${dateLabel(item.expiresAt)} · ` : " 有效期未记录 · "}
                    {item.sampleSize} 条来源
                  </p>
                  {item.signalTypes.length ? <p className="mt-1 text-muted-foreground">信号：{item.signalTypes.join("、")}</p> : null}
                  {item.warnings.length ? <p className="mt-1 text-amber-700">提示：{item.warnings.join("；")}</p> : null}
                  {item.sourceUrl ? (
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <a className="text-primary underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看原文</a>
                      <span className="text-muted-foreground">
                        {item.sourceUrlKind === "derived" ? "由来源 ID 推导，非上游原始链接" : item.sourceUrlKind === "upstream" ? "上游原始链接" : "来源：历史记录"}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-muted-foreground">来源链接不可用（上游未提供，且该平台无法由 ID 推导）</p>
                  )}
                </article>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">当前没有可核对的攻略证据。</p>}

          {warnings?.length ? (
            <details className="text-xs text-amber-700">
              <summary className="cursor-pointer">平台提示（{warnings.length}）</summary>
              <div className="mt-1 space-y-1">
                {warnings.slice(0, 6).map((warning, index) => <p key={`${warning}-${index}`}>平台提示：{warning}</p>)}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
