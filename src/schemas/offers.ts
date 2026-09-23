import { z } from "zod";

export const offerKindSchema = z.enum(["hotel", "flight", "train", "ticket", "restaurant", "coupon"]);
export const offerSchema = z.object({
  id: z.string().min(1),
  kind: offerKindSchema,
  title: z.string().min(1),
  provider: z.enum(["amap", "fliggy", "meituan"]),
  city: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  priceLabel: z.string().optional(),
  availability: z.enum(["available", "unknown", "unavailable"]).optional(),
  inventoryLabel: z.string().optional(),
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
  overall: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]),
  hotel: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  train: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  flight: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  ticket: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  restaurant: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  coupon: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  weather: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED"]).optional(),
  fetchedAt: z.string().datetime().optional(),
  warnings: z.array(z.string()).optional(),
});
