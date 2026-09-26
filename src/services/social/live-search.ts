import { createHash } from "node:crypto";
import { createTikHubProvider } from "./tikhub";
import { extractSocialSignals } from "./signal-extractor";
import type { SocialEvidence, SocialObservation, SocialPlatform, SocialSignal } from "./types";

const PLATFORMS: SocialPlatform[] = ["douyin", "xiaohongshu", "weibo", "wechat_search"];
const MAX_OBSERVATIONS = 20;
const MAX_SIGNALS = 10;
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { expiresAt: number; result: LiveSocialSearchResult }>();

export interface LiveSocialSearchInput {
  city: string;
  query?: string;
  poi?: string;
}

export interface LiveSocialSearchResult {
  queryId: string;
  observations: SocialObservation[];
  signals: SocialSignal[];
  evidence: SocialEvidence[];
  warnings: string[];
  platformStatus: Record<string, "ok" | "unavailable" | "error">;
}

function dedupe(observations: SocialObservation[]) {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    const normalized = observation.content.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180);
    const fingerprint = createHash("sha1").update(normalized).digest("hex");
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export async function searchTravelSocial(input: LiveSocialSearchInput, providerOverride?: Pick<ReturnType<typeof createTikHubProvider>, "searchContent">): Promise<LiveSocialSearchResult> {
  const query = [input.poi, input.query].filter(Boolean).join(" ").trim().slice(0, 100);
  const cacheKey = `${input.city}|${query}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const provider = providerOverride ?? createTikHubProvider();
  const settled = await Promise.all(PLATFORMS.map(async (platform) => {
    try {
      const result = await provider.searchContent({ city: input.city, query, platform, limit: 5 });
      return { platform, result };
    } catch (error) {
      return { platform, result: { status: "error" as const, data: [], warnings: [error instanceof Error ? error.message : "social search failed"] } };
    }
  }));
  const observations = dedupe(settled.flatMap(({ result }) => result.data)
    .filter((item) => item.content.includes(input.city) || (input.poi && item.content.includes(input.poi)))
    .filter((item) => !item.publishedAt || Date.now() - Date.parse(item.publishedAt) < 30 * 86_400_000)).slice(0, MAX_OBSERVATIONS);
  const signals = extractSocialSignals(observations).slice(0, MAX_SIGNALS);
  const warnings = settled.flatMap(({ platform, result }) => result.warnings.map((warning) => `${platform}: ${warning}`));
  const platformStatus = Object.fromEntries(settled.map(({ platform, result }) => [platform, result.status === "ok" && result.data.length === 0 ? "unavailable" : result.status]));
  const evidence = observations.map((observation) => {
    const related = signals.filter((signal) => signal.sources.some((source) => source.sourceId === observation.sourceId && source.platform === observation.platform));
    return {
      platform: observation.platform,
      sourceId: observation.sourceId,
      sourceUrl: observation.sourceUrl,
      summary: observation.summary ?? observation.content.slice(0, 180),
      city: observation.city,
      publishedAt: observation.publishedAt,
      fetchedAt: observation.fetchedAt,
      signalTypes: related.map((signal) => signal.signalType),
      confidence: related.length ? Math.max(...related.map((signal) => signal.confidence)) : 0.25,
      sampleSize: related.length ? Math.max(...related.map((signal) => signal.sampleSize)) : 1,
      warnings: ["社交平台内容仅作攻略参考，不替代实时供应商事实"],
    } satisfies SocialEvidence;
  });
  const output = {
    queryId: createHash("sha256").update(`${input.city}|${input.poi ?? ""}|${input.query ?? ""}`).digest("hex").slice(0, 32),
    observations,
    signals,
    evidence,
    warnings,
    platformStatus,
  };
  cache.set(cacheKey, { expiresAt: Date.now() + (observations.length ? CACHE_TTL_MS : 2 * 60_000), result: output });
  return output;
}
