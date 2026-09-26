"use client";

import type { SocialEvidence } from "@/services/social/types";
import type { Trip } from "@/types/travel";

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
  if (!evidence?.length && !warnings?.length && !platformStatus && !queryStatus && !planningMetadata) return null;
  const statuses = Object.entries(platformStatus ?? {});
  return (
    <section className="border-b border-border p-4" aria-label="本次规划来源">
      {planningMetadata ? (
        <div className="rounded-lg border border-border bg-background/60 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <strong>本次规划来源</strong>
            <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              {planningMetadata.source === "llm" ? "LLM 辅助排序" : "确定性规则规划"}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
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
      <div className={planningMetadata ? "mt-4" : ""}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">联网攻略参考</h2>
          {queryStatus ? <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{STATUS_LABELS[queryStatus]}</span> : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">平台内容仅供参考；地点、天气、路线与报价以实时供应商数据为准。</p>
      </div>
      {statuses.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="社交平台查询状态">
          {statuses.map(([platform, status]) => (
            <span key={platform} className={`rounded-full border px-2 py-1 text-[11px] ${status === "ok" ? "border-emerald-500/30 text-emerald-700" : status === "error" ? "border-rose-500/30 text-rose-700" : "border-border text-muted-foreground"}`}>
              {LABELS[platform] ?? platform} · {STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      ) : null}
      {evidence?.length ? <div className="mt-3 space-y-2">
        {evidence.slice(0, 8).map((item) => <article key={`${item.provider ?? "unknown"}-${item.platform}-${item.sourceId}`} className="rounded-lg border border-border p-3 text-xs">
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
          {item.sourceUrl ? <a className="mt-2 inline-block text-primary underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看原文</a> : <p className="mt-2 text-muted-foreground">来源链接不可用</p>}
        </article>)}
      </div> : <p className="mt-3 text-xs text-muted-foreground">当前没有可核对的攻略证据。</p>}
      {warnings?.length ? (
        <div className="mt-3 space-y-1 text-xs text-amber-700">
          {warnings.slice(0, 6).map((warning, index) => <p key={`${warning}-${index}`}>平台提示：{warning}</p>)}
        </div>
      ) : null}
    </section>
  );
}
