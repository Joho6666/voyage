import { z } from "zod";

export const offerKindSchema = z.enum(["hotel", "flight", "train", "ticket", "restaurant", "coupon"]);
export const offerSchema = z.object({
  id: z.string().min(1),
  kind: offerKindSchema,
  title: z.string().min(1),
  imageUrl: z.string().url().optional(),
  provider: z.enum(["amap", "fliggy", "meituan"]),
  city: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
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
  overall: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]),
  hotel: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  train: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  flight: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  ticket: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  restaurant: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  coupon: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  weather: z.enum(["REAL", "UNAVAILABLE", "UNKNOWN", "UNSTRUCTURED", "ESTIMATED", "PERMISSION_REQUIRED"]).optional(),
  fetchedAt: z.string().datetime().optional(),
  warnings: z.array(z.string()).optional(),
});
