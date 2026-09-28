import { z } from "zod";
import { chatJson, getLlmConfig } from "@/services/ai/llm";
import { resolveSourceLink } from "@/services/social/source-link";
import type { SocialObservation } from "@/services/social/types";
import type { SocialProviderRouter } from "@/services/social/router";
import type { Place } from "@/types/travel";

/** The slice of the travel provider the guide resolver needs (AmapTravelProvider satisfies this). */
export interface GuidePlaceProvider {
  searchPlaces(input: { destination: string; query: string; limit: number }): Promise<Place[]>;
}

/**
 * 小红书攻略 → 行程地点。
 *
 * The post is only a free-text hint. Names are *candidates* extracted from the
 * text (LLM first, deterministic rules as fallback); every candidate must then
 * resolve to a real provider POI. Nothing that fails resolution is invented —
 * it comes back listed as unresolved so the traveller sees exactly what could
 * and could not be verified.
 */

export const MAX_GUIDE_POSTS = 4;
export const MAX_GUIDE_CANDIDATES = 8;
const MAX_POST_CONTENT_CHARS = 2000;

export interface GuidePost {
  platform: string;
  sourceId: string;
  /** First line-ish summary for the card; the full bounded text drives parsing. */
  summary: string;
  content: string;
  publishedAt?: string;
  fetchedAt: string;
  expiresAt?: string;
  sourceUrl?: string;
  sourceUrlKind?: "upstream" | "derived";
  metrics: Record<string, number>;
}

export interface GuidePostsResult {
  posts: GuidePost[];
  platformStatus: Record<string, "ok" | "unavailable" | "error">;
  warnings: string[];
}

const ROUTE_MARKERS = /(→|➜|—|–|\bday\s*\d|第[一二三四五六七]天|[四五六七]天[三四五]晚|路线|行程|攻略)/i;

/** Viral-guide posts: prefer texts that actually describe a route. */
export async function collectGuidePosts(
  router: SocialProviderRouter,
  city: string,
  query = "旅游攻略 路线",
  limit = 8,
): Promise<GuidePostsResult> {
  const result = await router.searchContent({ city, query: `${city} ${query}`, platform: "xiaohongshu", limit });
  const observations = result.data
    .filter((item) => item.content.length >= 60)
    .sort((left, right) => {
      const leftScore = (ROUTE_MARKERS.test(left.content) ? 2 : 0) + Math.min(left.content.length / 400, 1);
      const rightScore = (ROUTE_MARKERS.test(right.content) ? 2 : 0) + Math.min(right.content.length / 400, 1);
      return rightScore - leftScore;
    })
    .slice(0, MAX_GUIDE_POSTS);

  const posts = observations.map(guidePostFromObservation);
  return {
    posts,
    platformStatus: { xiaohongshu: result.status === "ok" && result.data.length === 0 ? "unavailable" : result.status },
    warnings: result.warnings,
  };
}

const candidateListSchema = z.object({
  names: z.array(z.string().trim().min(2).max(20)).max(MAX_GUIDE_CANDIDATES),
}).strict();

const STOPWORDS = /攻略|路线|行程|安排|推荐|打卡|时间|住宿|酒店|民宿|早上|中午|下午|晚上|傍晚|上午|全天|交通|地铁|公交|步行|打车|出发|到达|返回|附近|周边|必去|值得|小时|分钟|人均|门票|免费|开放|营业|美食|早餐|午餐|晚餐|夜宵|第一天|第二天|第三天|第四天|第五天|第六天|第七天|最后一天|一天|半天|^day|^day\d/i;

/** Prefix/suffix filler that may be glued to a real name inside one segment. */
const GLUE = /(第[一二三四五六七八九十\d]+天|day\s*\d+|上午|下午|中午|晚上|傍晚|早上|清晨|凌晨|先去|再去|然后|接着|顺便|最后|就近|住宿|推荐|打卡|必去|游玩|去|到|逛)/gi;
const TRAILING_GLUE = /(一日游|两日游|三日游|四日游|五日游|攻略|游记|推荐)$/;

function stripGlue(value: string) {
  let current = value;
  for (let round = 0; round < 5; round += 1) {
    const next = current.replace(GLUE, "").replace(TRAILING_GLUE, "").trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

function isPlausibleName(value: string) {
  const trimmed = value.replace(/^[«「【"(“'\s]+|[»」】")”'\s]+$/g, "").trim();
  if (trimmed.length < 2 || trimmed.length > 12) return false;
  // A real place name in this corpus is Chinese, or a Latin brand name of at
  // least four characters ("M Stand"); two-letter Latin fragments are noise.
  if (!/[\u4e00-\u9fa5]/.test(trimmed) && !/^[A-Za-z][A-Za-z0-9'&.\- ]{3,}$/.test(trimmed)) return false;
  if (STOPWORDS.test(trimmed) && !/[\u4e00-\u9fa5]{2}(路|街|巷|广场|公园|博物馆|纪念馆|寺|庙|塔|楼|桥|湖|山|湾|滩|岛|村|镇|市场|中心)/.test(trimmed)) return false;
  return true;
}

/** Deterministic fallback: split route-style text and keep plausible place fragments. */
export function extractCandidatesWithRules(text: string): string[] {
  const segments = text
    .replace(/\s+/g, " ")
    .split(/[→➜⇒—–\->|｜/、，,;；。!！?？：:\n（）()【】\[\]«»"“”]+/);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    for (const part of [segment, stripGlue(segment)]) {
      const value = typeof part === "string" ? part.trim() : "";
      if (!isPlausibleName(value)) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(value);
      break;
    }
    if (names.length >= MAX_GUIDE_CANDIDATES) break;
  }
  return names;
}

function llmEnabled() {
  if (process.env.VOYAGE_LLM_ENABLED === "0") return false;
  if (process.env.NODE_ENV === "test" && process.env.VOYAGE_LLM_ENABLED !== "1") return false;
  return true;
}

export interface GuideNameExtraction {
  names: string[];
  source: "llm" | "rules";
  fallbackReason?: string;
}

/**
 * Candidate names from post text. The LLM may only quote names that appear in
 * the text; schema + plausibility filters strip anything else. No candidate is
 * a place until the provider resolves it.
 */
export async function extractGuidePlaceNames(text: string): Promise<GuideNameExtraction> {
  const bounded = text.slice(0, 3000);
  if (!llmEnabled() || !getLlmConfig()) {
    return {
      names: extractCandidatesWithRules(bounded),
      source: "rules",
      fallbackReason: llmEnabled() ? "LLM 未配置，使用规则抽取" : "当前运行环境未调用外部 LLM，使用规则抽取",
    };
  }
  try {
    const raw = await chatJson({
      messages: [
        {
          role: "system",
          content: [
            "你是地点名抽取器。从用户给出的游记/攻略文本中抽取具体地点名称（景点、街区、餐厅、商场、博物馆等）。",
            "规则：只输出文本中逐字出现的名称；不要改写、翻译、补全或编造；去掉日期、时间、交通和形容词；最多 8 个，按出现顺序。",
            '只输出严格 JSON：{"names":["名称1","名称2"]}',
          ].join("\n"),
        },
        { role: "user", content: bounded },
      ],
      maxTokens: 400,
    });
    const parsed = candidateListSchema.safeParse(raw);
    if (!parsed.success) throw new Error("LLM guide extraction failed schema validation");
    const names = [...new Set(parsed.data.names.filter(isPlausibleName))].slice(0, MAX_GUIDE_CANDIDATES);
    if (!names.length) throw new Error("LLM guide extraction returned no plausible names");
    return { names, source: "llm" };
  } catch (error) {
    return {
      names: extractCandidatesWithRules(bounded),
      source: "rules",
      fallbackReason: error instanceof Error ? error.message.slice(0, 160) : "LLM 抽取失败，使用规则抽取",
    };
  }
}

export interface GuideCandidate {
  name: string;
  resolved: boolean;
  /** Present only when the provider resolved the name to a real POI. */
  place?: Place;
  matchBasis?: "exact" | "partial";
  reason?: string;
}

/**
 * Only an exact name or a meaningful containment counts as a match. The old
 * "first result" fallback once paired the junk phrase 全程适配懒人 with a nail
 * salon — a manufactured match, exactly what this feature must never do.
 */
function bestMatch(candidates: Place[], name: string): { place?: Place; matchBasis?: GuideCandidate["matchBasis"] } {
  const exact = candidates.find((place) => place.name === name);
  if (exact) return { place: exact, matchBasis: "exact" };
  const partial = candidates.find((place) => place.name.includes(name) || name.includes(place.name));
  if (partial) return { place: partial, matchBasis: "partial" };
  return {};
}

const AMAP_GUIDE_STAGGER_MS = 400;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchOnce(provider: GuidePlaceProvider, city: string, name: string) {
  try {
    return await provider.searchPlaces({ destination: city, query: name, limit: 5 });
  } catch (error) {
    // AMap enforces a per-second quota; one spaced retry turns a burst of
    // candidate lookups into results instead of a row of false failures.
    const message = error instanceof Error ? error.message : "";
    if (!/QPS|EXCEEDED|LIMIT/i.test(message)) throw error;
    await sleep(700);
    return provider.searchPlaces({ destination: city, query: name, limit: 5 });
  }
}

/** Resolve each name against the real provider. Failures stay failures. */
export async function resolveGuideCandidates(
  provider: GuidePlaceProvider,
  city: string,
  names: string[],
): Promise<GuideCandidate[]> {
  const candidates: GuideCandidate[] = [];
  for (const [index, name] of names.entries()) {
    if (index > 0) await sleep(AMAP_GUIDE_STAGGER_MS);
    try {
      const places = await searchOnce(provider, city, name);
      const { place, matchBasis } = bestMatch(places, name);
      candidates.push(
        place
          ? { name, resolved: true, place, matchBasis }
          : { name, resolved: false, reason: "本地数据源未找到该名称对应的真实地点" },
      );
    } catch (error) {
      candidates.push({ name, resolved: false, reason: error instanceof Error ? error.message.slice(0, 120) : "地点解析失败" });
    }
  }
  return candidates;
}

export function guidePostFromObservation(observation: SocialObservation): GuidePost {
  const link = resolveSourceLink({ platform: observation.platform, sourceId: observation.sourceId, upstreamUrl: observation.sourceUrl });
  return {
    platform: observation.platform,
    sourceId: observation.sourceId,
    summary: observation.summary ?? observation.content.slice(0, 160),
    content: observation.content.slice(0, MAX_POST_CONTENT_CHARS),
    publishedAt: observation.publishedAt,
    fetchedAt: observation.fetchedAt,
    expiresAt: observation.expiresAt,
    ...(link ? { sourceUrl: link.url, sourceUrlKind: link.kind } : {}),
    metrics: observation.metrics ?? {},
  };
}
