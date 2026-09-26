import { createSocialAdapter, SocialProviderRequestError, type SocialRequestTransport } from "./provider";
import { runtimeConfigSync } from "@/services/config/local-credentials";

const TIKHUB_API_BASE_URL = "https://api.tikhub.io";
const REQUEST_TIMEOUT_MS = 12_000;

const SEARCH_ENDPOINTS = {
  tiktok: { method: "GET", path: "/api/v1/tiktok/web/fetch_general_search" },
  douyin: { method: "POST", path: "/api/v1/douyin/search/fetch_general_search_v3" },
  xiaohongshu: { method: "GET", path: "/api/v1/xiaohongshu/app_v2/search_notes" },
  weibo: { method: "GET", path: "/api/v1/weibo/app/fetch_search_all" },
  wechat_search: { method: "POST", path: "/api/v1/wechat_search/v2/fetch_search" },
} as const;

function searchEndpoint(platform: string) {
  return SEARCH_ENDPOINTS[platform as keyof typeof SEARCH_ENDPOINTS];
}

function buildRequest(input: { platform?: string; query?: string; city?: string; limit?: number }) {
  const platform = input.platform ?? "tiktok";
  const endpoint = searchEndpoint(platform);
  if (!endpoint) throw new SocialProviderRequestError(`TikHub search is not configured for ${platform}`);
  const keyword = [input.city, input.query].filter(Boolean).join(" ").trim();
  if (!keyword) throw new SocialProviderRequestError("TikHub search requires a city or query");
  const limit = Math.min(input.limit ?? 10, 20);
  const params = platform === "weibo"
    ? { query: keyword, page: 1, search_type: 1 }
    : platform === "xiaohongshu"
      ? { keyword, page: 1, sort_type: "general", note_type: "不限", time_filter: "不限", search_id: "", search_session_id: "" }
      : platform === "wechat_search"
        ? { keyword, business_type: "all", sort: "default", publish_time: "all", offset: 0, cursor: null, raw: false }
        : { keyword, offset: 0, page: 1, search_id: "", backtrace: "", limit };
  return { endpoint, params };
}

function detailRequest(operation: string, input: { platform?: string; sourceId?: string; query?: string; city?: string }) {
  const id = input.sourceId?.trim();
  const platform = input.platform;
  if (operation === "getTrending") {
    if (platform === "douyin") return { method: "GET", path: "/api/v1/douyin/web/fetch_hot_search_result", params: {} };
    if (platform === "weibo") return { method: "GET", path: "/api/v1/weibo/web_v2/fetch_hot_search_summary", params: {} };
    throw new SocialProviderRequestError(`TikHub trending is not verified for ${platform}`);
  }
  if (!id) throw new SocialProviderRequestError("TikHub content lookup requires a source id");
  if (platform === "douyin" && operation === "getContent") return { method: "GET", path: "/api/v1/douyin/web/fetch_one_video", params: { aweme_id: id } };
  if (platform === "douyin" && operation === "getComments") return { method: "GET", path: "/api/v1/douyin/app/v3/fetch_video_comments", params: { aweme_id: id, cursor: 0, count: 20 } };
  if (platform === "xiaohongshu" && operation === "getContent") return { method: "GET", path: "/api/v1/xiaohongshu/web_v3/fetch_note_detail", params: { note_id: id, xsec_token: "" } };
  if (platform === "xiaohongshu" && operation === "getComments") return { method: "GET", path: "/api/v1/xiaohongshu/app_v2/get_note_comments", params: { note_id: id, cursor: "", index: 0 } };
  if (platform === "weibo" && operation === "getContent") return { method: "GET", path: "/api/v1/weibo/web_v2/fetch_post_detail", params: { id } };
  if (platform === "weibo" && operation === "getComments") return { method: "GET", path: "/api/v1/weibo/web_v2/fetch_post_comments", params: { id, count: 20, max_id: 0 } };
  throw new SocialProviderRequestError(`TikHub ${operation} is not verified for ${platform}`);
}

const TIKHUB_API_HOST = new URL(TIKHUB_API_BASE_URL).hostname;

/** Single network choke point: the sink refuses anything off the documented TikHub host. */
async function requestJson(url: URL, method: string, body: Record<string, unknown>, apiKey: string) {
  if (url.protocol !== "https:" || url.hostname !== TIKHUB_API_HOST) {
    throw new SocialProviderRequestError("TikHub request host mismatch");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store",
    });
    if (response.status === 429 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (response.status === 402) throw new SocialProviderRequestError("TikHub credits are insufficient for this endpoint");
    if (response.status === 401 || response.status === 403) throw new SocialProviderRequestError(`TikHub authorization or endpoint access denied (HTTP ${response.status})`);
    if (response.status === 429) throw new SocialProviderRequestError("TikHub rate limit exceeded after one retry");
    if (!response.ok) throw new SocialProviderRequestError(`TikHub request failed (HTTP ${response.status})`);
    const payload = await response.json() as { code?: unknown; detail?: { code?: unknown } };
    const code = Number(payload.code ?? payload.detail?.code ?? 200);
    if (Number.isFinite(code) && code >= 400) throw new SocialProviderRequestError(`TikHub rejected the request (code ${code})`);
    return payload;
  }
  throw new SocialProviderRequestError("TikHub request failed after retry");
}

/** TikTok web general search; this endpoint is documented by TikHub. */
export const tikHubSearchTransport: SocialRequestTransport = async ({ operation, apiKey, input }) => {
  const search = input as { platform?: string; city?: string; query?: string; limit?: number };
  const request = operation === "searchContent" ? buildRequest(search) : detailRequest(operation, input as { platform?: string; sourceId?: string; query?: string; city?: string });
  const { endpoint, params } = "endpoint" in request ? request : { endpoint: { method: request.method, path: request.path }, params: request.params };
  const base = new URL(TIKHUB_API_BASE_URL);
  const url = new URL(endpoint.path, base);
  // SSRF guard: request paths come from the static endpoint tables above, and
  // this check keeps the sink pinned to the documented host even if that
  // ever changes.
  if (url.protocol !== "https:" || url.hostname !== base.hostname) {
    throw new SocialProviderRequestError("TikHub request host mismatch");
  }
  const body: Record<string, unknown> = endpoint.method === "POST" ? {} : params;
  if (endpoint.method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  } else {
    Object.assign(body, params);
  }

  return requestJson(url, endpoint.method, body, apiKey);
};

export function createTikHubProvider(options: {
  apiKey?: string;
  transport?: SocialRequestTransport;
  now?: () => Date;
} = {}) {
  return createSocialAdapter({
    name: "tikhub",
    // An explicitly injected transport is useful for tests and future verified endpoints.
    platforms: options.transport ? ["tiktok", "instagram", "youtube", "x", "douyin", "xiaohongshu", "weibo", "wechat_search"] : ["tiktok", "douyin", "xiaohongshu", "weibo", "wechat_search"],
    supportedOperations: options.transport ? undefined : ["searchContent", "getContent", "getComments", "getTrending"],
    apiKey: options.apiKey ?? runtimeConfigSync("TIKHUB_API_KEY"),
    transport: options.transport ?? tikHubSearchTransport,
    now: options.now,
  });
}
