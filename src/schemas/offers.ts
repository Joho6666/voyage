import { z } from "zod";

export const offerKindSchema = z.enum(["hotel", "flight", "train", "ticket", "restaurant", "coupon"]);
export const offerSchema = z.object({
  id: z.string().min(1),
  kind: offerKindSchema,
  title: z.string().min(1),
  provider: z.literal("meituan"),
  city: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  priceLabel: z.string().optional(),
  availability: z.enum(["available", "unknown", "unavailable"]).optional(),
  ratingLabel: z.string().optional(),
  description: z.string().optional(),
  bookingUrl: z.string().url().optional(),
  sourceId: z.string().optional(),
  fetchedAt: z.string().datetime(),
  structured: z.boolean(),
  rawText: z.string().optional(),
  rawJson: z.unknown().optional(),
});

export const offerProviderStatusSchema = z.object({
  overall: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED"]),
  fetchedAt: z.string().datetime().optional(),
  warnings: z.array(z.string()).optional(),
});
