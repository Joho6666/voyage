"use client";

import type { SocialEvidence } from "@/services/social/types";

const LABELS: Record<string, string> = {
  douyin: "抖音", xiaohongshu: "小红书", weibo: "微博", wechat_search: "微信搜一搜",
};

export function SocialEvidencePanel({ evidence, warnings }: { evidence?: SocialEvidence[]; warnings?: string[] }) {
  if (!evidence?.length && !warnings?.length) return null;
  return (
    <section className="border-b border-border p-4" aria-label="联网攻略参考">
      <h2 className="text-sm font-semibold">联网攻略参考</h2>
      <p className="mt-1 text-xs text-muted-foreground">平台内容仅供参考；地点、天气、路线与报价以实时供应商数据为准。</p>
      {evidence?.length ? <div className="mt-3 space-y-2">
        {evidence.slice(0, 8).map((item) => <article key={`${item.platform}-${item.sourceId}`} className="rounded-lg border border-border p-3 text-xs">
          <div className="flex items-center justify-between gap-2"><strong>{LABELS[item.platform] ?? item.platform}</strong><span className="text-muted-foreground">置信度 {Math.round(item.confidence * 100)}%</span></div>
          <p className="mt-1 line-clamp-3">{item.summary}</p>
          <p className="mt-2 text-muted-foreground">{item.publishedAt ? `发布 ${new Date(item.publishedAt).toLocaleDateString("zh-CN")} · ` : ""}抓取 {new Date(item.fetchedAt).toLocaleDateString("zh-CN")} · {item.sampleSize} 条来源</p>
          {item.signalTypes.length ? <p className="mt-1 text-muted-foreground">信号：{item.signalTypes.join("、")}</p> : null}
          {item.sourceUrl ? <a className="mt-2 inline-block text-primary underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看原文</a> : <p className="mt-2 text-muted-foreground">来源链接不可用</p>}
        </article>)}
      </div> : <p className="mt-3 text-xs text-muted-foreground">当前没有可核对的攻略证据。</p>}
      {warnings?.length ? <p className="mt-2 text-xs text-muted-foreground">部分平台暂不可用；行程仍使用已验证的地点数据。</p> : null}
    </section>
  );
}
