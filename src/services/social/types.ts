export type SocialPlatform =
  | "tiktok" | "instagram" | "youtube" | "x" | "douyin"
  | "xiaohongshu" | "weibo" | "wechat" | "wechat_channels" | "wechat_mp" | "wechat_search";

export type SocialProviderName = "tikhub" | "redfox";
export type SocialSignalType =
  | "crowd_risk" | "popular_time" | "travel_warning" | "trend_score" | "price_signal";

export interface SocialSource {
  provider: SocialProviderName;
  platform: SocialPlatform;
  sourceId: string;
  sourceUrl?: string;
  publishedAt?: string;
}

export interface SocialObservation extends SocialSource {
  city: string;
  entityType?: string;
  entityId?: string;
  content: string;
  summary?: string;
  fetchedAt: string;
  expiresAt: string;
  metrics: Record<string, number>;
  rawMetadata: Record<string, unknown>;
}

export interface SocialComment {
  id: string;
  content: string;
  publishedAt?: string;
}

export interface SocialSearchInput {
  city: string;
  query?: string;
  platform?: SocialPlatform;
  limit?: number;
}

export interface SocialContentInput {
  platform: SocialPlatform;
  sourceId: string;
  city?: string;
  limit?: number;
}

export type SocialProviderStatus = "ok" | "unavailable" | "error";

export interface SocialProviderResult<T> {
  status: SocialProviderStatus;
  data: T;
  warnings: string[];
}

export type SocialSignalValue =
  | { risk: number }
  | { start: string; end: string }
  | { message: string }
  | { score: number }
  | { amount: number; currency: "CNY"; reported: true };

export interface SocialSignal {
  id: string;
  city: string;
  entityId?: string;
  signalType: SocialSignalType;
  value: SocialSignalValue;
  confidence: number;
  sampleSize: number;
  platformCount: number;
  observedAt: string;
  expiresAt: string;
  sources: SocialSource[];
}

export interface SocialContext {
  city: string;
  entityId?: string;
  crowdRisk: "low" | "medium" | "high" | "unknown";
  recentTrend?: number;
  warnings: string[];
  popularTimes: Array<{ start: string; end: string; confidence: number }>;
  confidence: number;
  sources: SocialSource[];
  signals: SocialSignal[];
}

export interface SocialEvidence {
  platform: SocialPlatform;
  sourceId: string;
  sourceUrl?: string;
  title?: string;
  summary: string;
  city: string;
  publishedAt?: string;
  fetchedAt: string;
  signalTypes: SocialSignalType[];
  confidence: number;
  sampleSize: number;
  warnings: string[];
}
