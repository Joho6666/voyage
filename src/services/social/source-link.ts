/**
 * Source links for social evidence.
 *
 * Upstream search payloads from the social providers carry an id but usually no
 * public URL, so a card with only the upstream value would read "来源链接不可用"
 * even though a real post exists.  These are the platforms' own canonical URL
 * shapes for an id, and every derived link is labelled as derived — never
 * presented as the URL the upstream API returned.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export type SourceUrlKind = "upstream" | "derived";

export interface ResolvedSourceLink {
  url: string;
  kind: SourceUrlKind;
}

function usableId(sourceId: string | undefined) {
  const trimmed = sourceId?.trim();
  return trimmed && ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** Canonical public URL for a platform item id, or undefined when unknown. */
export function canonicalSourceUrl(platform: string, sourceId: string | undefined): string | undefined {
  const id = usableId(sourceId);
  if (!id) return undefined;
  switch (platform) {
    case "xiaohongshu":
      return `https://www.xiaohongshu.com/explore/${id}`;
    case "weibo":
      return `https://m.weibo.cn/detail/${id}`;
    case "douyin":
    case "tiktok":
      return `https://www.douyin.com/video/${id}`;
    default:
      // Platforms without a stable public id-based URL (e.g. wechat_search)
      // deliberately resolve to nothing rather than inventing a path.
      return undefined;
  }
}

/**
 * Prefer the upstream URL when the provider actually returned one; otherwise
 * derive from the platform's id shape.  Returns undefined when neither exists,
 * so callers can keep saying "unavailable" honestly.
 */
export function resolveSourceLink(input: {
  platform: string;
  sourceId?: string;
  upstreamUrl?: string;
}): ResolvedSourceLink | undefined {
  const upstream = input.upstreamUrl?.trim();
  if (upstream && /^https:\/\//i.test(upstream)) return { url: upstream, kind: "upstream" };
  const derived = canonicalSourceUrl(input.platform, input.sourceId);
  return derived ? { url: derived, kind: "derived" } : undefined;
}

export const SOURCE_LINK_KIND_LABEL: Record<SourceUrlKind, string> = {
  upstream: "上游原始链接",
  derived: "由来源 ID 推导",
};
