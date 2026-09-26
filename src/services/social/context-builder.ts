import type { SocialContext, SocialSignal, SocialSource } from "./types";

export interface SocialContextInput {
  city: string;
  poi?: string;
  query?: string;
  time?: string;
}

function uniqueSources(signals: SocialSignal[]): SocialSource[] {
  const sources = new Map<string, SocialSource>();
  for (const signal of signals) for (const source of signal.sources) {
    sources.set(`${source.provider}|${source.platform}|${source.sourceId}`, source);
  }
  return [...sources.values()];
}

export function buildSocialContext(input: SocialContextInput, signals: SocialSignal[], now = new Date()): SocialContext {
  const matching = signals.filter((signal) =>
    signal.city === input.city && (!input.poi || !signal.entityId || signal.entityId === input.poi) &&
    Number.isFinite(Date.parse(signal.expiresAt)) && Date.parse(signal.expiresAt) > now.getTime() &&
    signal.confidence > 0 && signal.sources.length > 0,
  );
  const risk = Math.max(0, ...matching.filter((signal) => signal.signalType === "crowd_risk")
    .map((signal) => "risk" in signal.value ? signal.value.risk : 0));
  const crowdRisk = risk === 0 ? "unknown" : risk >= 0.67 ? "high" : risk >= 0.34 ? "medium" : "low";
  const trends = matching.filter((signal) => signal.signalType === "trend_score")
    .map((signal) => "score" in signal.value ? signal.value.score : 0);
  const popularTimes = matching.filter((signal) => signal.signalType === "popular_time")
    .flatMap((signal) => "start" in signal.value ? [{ start: signal.value.start, end: signal.value.end, confidence: signal.confidence }] : []);
  if (input.time) popularTimes.sort((a, b) => Number(b.start <= input.time! && input.time! < b.end) - Number(a.start <= input.time! && input.time! < a.end));
  return {
    city: input.city, entityId: input.poi, crowdRisk,
    recentTrend: trends.length ? Math.max(...trends) : undefined,
    warnings: matching.filter((signal) => signal.signalType === "travel_warning")
      .flatMap((signal) => "message" in signal.value ? [signal.value.message] : []),
    popularTimes,
    confidence: matching.length ? matching.reduce((sum, signal) => sum + signal.confidence, 0) / matching.length : 0,
    sources: uniqueSources(matching),
    signals: matching,
  };
}

/** Loads social signals from an injected store; no database or API is required. */
export class SocialContextBuilder {
  constructor(private readonly loadSignals: (input: SocialContextInput) => Promise<SocialSignal[]>) {}

  async build(input: SocialContextInput, now = new Date()): Promise<SocialContext> {
    try { return buildSocialContext(input, await this.loadSignals(input), now); }
    catch { return buildSocialContext(input, [], now); }
  }
}
