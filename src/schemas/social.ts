import { z } from "zod";

/**
 * zod's .url() only checks parsability and happily accepts `javascript:` —
 * externally supplied links that end up rendered as hrefs must be https.
 */
export const socialHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "Only https links are accepted");

export const socialPlatformSchema = z.enum([
  "tiktok",
  "instagram",
  "youtube",
  "x",
  "douyin",
  "xiaohongshu",
  "weibo",
  "wechat",
  "wechat_channels",
  "wechat_mp",
  "wechat_search",
]);

export const socialProviderNameSchema = z.enum(["tikhub", "redfox"]);
export const socialProviderStatusSchema = z.enum(["ok", "unavailable", "error"]);
export const socialSignalTypeSchema = z.enum([
  "crowd_risk",
  "popular_time",
  "travel_warning",
  "trend_score",
  "price_signal",
]);

export const socialSourceSchema = z.object({
  provider: socialProviderNameSchema,
  platform: socialPlatformSchema,
  sourceId: z.string().min(1),
  sourceUrl: socialHttpsUrlSchema.optional(),
  publishedAt: z.string().datetime().optional(),
});

export const socialSignalValueSchema = z.union([
  z.object({ risk: z.number().min(0).max(1) }),
  z.object({ start: z.string().min(1), end: z.string().min(1) }),
  z.object({ message: z.string().min(1) }),
  z.object({ score: z.number().min(0).max(1) }),
  z.object({ amount: z.number().positive(), currency: z.literal("CNY"), reported: z.literal(true) }),
]);

export const socialSignalSchema = z.object({
  id: z.string().min(1),
  city: z.string().min(1),
  entityId: z.string().optional(),
  signalType: socialSignalTypeSchema,
  value: socialSignalValueSchema,
  confidence: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
  platformCount: z.number().int().nonnegative(),
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  sources: z.array(socialSourceSchema),
});

export const socialEvidenceSchema = z.object({
  provider: socialProviderNameSchema.optional(),
  platform: socialPlatformSchema,
  sourceId: z.string().min(1),
  sourceUrl: socialHttpsUrlSchema.optional(),
  sourceUrlKind: z.enum(["upstream", "derived"]).optional(),
  title: z.string().optional(),
  summary: z.string().min(1),
  city: z.string().min(1),
  publishedAt: z.string().datetime().optional(),
  fetchedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  signalTypes: z.array(socialSignalTypeSchema),
  confidence: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
  metrics: z.record(z.string(), z.number()).optional(),
  poiMatches: z.array(z.object({
    placeId: z.string().min(1),
    name: z.string().min(1),
    confidence: z.number().min(0).max(1),
    matchBasis: z.enum(["entity_id", "name_contains", "unknown"]),
  })).default([]),
  warnings: z.array(z.string()).default([]),
});

export const socialPlatformStatusSchema = z.record(z.string(), socialProviderStatusSchema);
