import { assertPublicFetchUrl } from "@/lib/safe-url";

/**
 * Parse a 小红书/抖音 link (long or short) into the ids the social provider's
 * detail endpoint needs. Everything here is server-side: short links are
 * resolved by following redirects manually, and every hop is checked against
 * the platform host whitelist AND the strict public-address guard, so a
 * pasted link can never make the server fetch an arbitrary host.
 */

export interface ParsedSocialLink {
  platform: "xiaohongshu" | "douyin";
  sourceId: string;
  /** Carried when the link includes it; the app_v2 detail endpoint also works without. */
  xsecToken?: string;
  /** Canonical URL handed to the detail endpoint as share_text. */
  shareUrl: string;
}

/** Only these hosts may ever be fetched or followed to. */
const LINK_HOSTS = new Set([
  "xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com",
  "douyin.com", "www.douyin.com", "v.douyin.com", "iesdouyin.com", "www.iesdouyin.com",
]);

const SHORT_LINK_HOSTS = new Set(["xhslink.com", "www.xhslink.com", "v.douyin.com"]);

const URL_PATTERN = /https?:\/\/[^\s，。；！？、"'<>）)】\]]+/i;

function hostAllowed(host: string) {
  const normalized = host.toLowerCase();
  return LINK_HOSTS.has(normalized) || normalized.endsWith(".xiaohongshu.com") || normalized.endsWith(".douyin.com");
}

/** Follow redirects one hop at a time, validating each target. */
async function resolveShortLink(start: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let current = start;
  for (let hop = 0; hop < 3; hop += 1) {
    const url = assertPublicFetchUrl(current);
    if (!hostAllowed(url.hostname)) throw new Error("链接指向了不支持的站点");
    // Only short-link hosts need fetching: once the chain lands on a
    // canonical platform URL we already have the id and stop there.
    if (!SHORT_LINK_HOSTS.has(url.hostname.toLowerCase())) return url.toString();
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; VoyageBot/1.0)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, url).toString();
      continue;
    }
    // A short link answering 200 with a page (risk/verification wall) cannot
    // be parsed any further; hand back what we have so the caller fails honestly.
    return url.toString();
  }
  return current;
}

function parseNoteFromUrl(url: URL): { sourceId?: string; xsecToken?: string } {
  const path = url.pathname;
  const xsecToken = url.searchParams.get("xsec_token") ?? undefined;
  const noteMatch = path.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/);
  if (noteMatch) return { sourceId: noteMatch[1], xsecToken };
  return { xsecToken };
}

function parseVideoFromUrl(url: URL): { sourceId?: string } {
  const path = url.pathname;
  const videoMatch = path.match(/\/(?:video|share\/video|note)\/(\d{6,})/);
  if (videoMatch) return { sourceId: videoMatch[1] };
  const queryId = url.searchParams.get("vid") ?? url.searchParams.get("aweme_id");
  return queryId ? { sourceId: queryId } : {};
}

/**
 * Returns the parsed link, or null when the text contains no supported link.
 * Throws a readable Chinese error when a supported link cannot be resolved.
 */
export async function parseSocialLink(text: string, fetchImpl: typeof fetch = fetch): Promise<ParsedSocialLink | null> {
  const raw = text.match(URL_PATTERN)?.[0];
  if (!raw) return null;
  let url: URL;
  try {
    url = assertPublicFetchUrl(raw);
  } catch {
    return null; // Not a fetchable public URL — treat the text as ordinary input.
  }
  if (!hostAllowed(url.hostname)) return null;

  let resolved = url;
  if (SHORT_LINK_HOSTS.has(url.hostname.toLowerCase())) {
    const finalUrl = await resolveShortLink(url.toString(), fetchImpl);
    try {
      resolved = new URL(finalUrl);
    } catch {
      throw new Error("短链解析失败，可改用「粘贴攻略文本」");
    }
    // Still on the short-link host: the link served a page instead of
    // redirecting (风控页), so there is no note/video id to work with.
    if (SHORT_LINK_HOSTS.has(resolved.hostname.toLowerCase())) {
      throw new Error("短链没有跳转到笔记/视频页，可改用「粘贴攻略文本」");
    }
  }

  if (resolved.hostname.toLowerCase().includes("xiaohongshu")) {
    const { sourceId, xsecToken } = parseNoteFromUrl(resolved);
    if (!sourceId) throw new Error("没有从小红书链接里识别出笔记 ID，可改用「粘贴攻略文本」");
    const shareUrl = `https://www.xiaohongshu.com/explore/${sourceId}${xsecToken ? `?xsec_token=${xsecToken}&xsec_source=pc_search` : ""}`;
    return { platform: "xiaohongshu", sourceId, xsecToken, shareUrl };
  }

  const { sourceId } = parseVideoFromUrl(resolved);
  if (!sourceId) throw new Error("没有从抖音链接里识别出视频 ID，可改用「粘贴攻略文本」");
  return { platform: "douyin", sourceId, shareUrl: `https://www.douyin.com/video/${sourceId}` };
}
