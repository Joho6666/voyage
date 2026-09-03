import { z } from "zod";

export const placeCategorySchema = z.enum([
  "attraction",
  "food",
  "cafe",
  "hotel",
  "activity",
  "shopping",
  "transport",
  "viewpoint",
]);

export const itineraryItemTypeSchema = z.enum([
  "place",
  "food",
  "hotel",
  "activity",
  "transport",
  "note",
]);

export const itemStatusSchema = z.enum(["planned", "current", "done", "skipped"]);
export const taskStatusSchema = z.enum(["todo", "done"]);
export const tripStatusSchema = z.enum(["draft", "ready", "traveling", "done"]);
export const transportKindSchema = z.enum([
  "highspeed",
  "flight",
  "metro",
  "walk",
  "taxi",
  "bus",
]);
export const openingStatusSchema = z.enum(["open", "closed", "unknown"]);
export const budgetCategorySchema = z.enum([
  "transport",
  "stay",
  "food",
  "ticket",
  "shop",
  "other",
]);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const placeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: placeCategorySchema,
  lat: z.number(),
  lng: z.number(),
  rating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
  image: z.string(),
  priceLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  priceLabel: z.string().optional(),
  address: z.string(),
  openingHours: z.string().optional(),
  openingStatus: openingStatusSchema,
  stayMinutes: z.number().int().min(0),
  description: z.string(),
  tags: z.array(z.string()),
  district: z.string(),
  estimatedCost: z.number().optional(),
  source: z.enum(["amap", "demo", "llm", "user"]).optional(),
  sourceId: z.string().optional(),
});

export const daySchema = z.object({
  id: z.string().min(1),
  tripId: z.string().min(1),
  index: z.number().int().min(0),
  date: isoDate,
  title: z.string(),
  summary: z.string(),
  weather: z.object({
    tempC: z.number(),
    condition: z.string(),
    icon: z.enum(["sun", "cloud", "rain", "overcast"]),
  }),
});

export const itineraryItemSchema = z.object({
  id: z.string().min(1),
  dayId: z.string().min(1),
  type: itineraryItemTypeSchema,
  placeId: z.string().min(1),
  startTime: hhmm,
  endTime: hhmm.optional(),
  duration: z.number().int().min(0),
  order: z.number().int().min(0),
  status: itemStatusSchema,
  notes: z.string().optional(),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  reservationId: z.string().optional(),
});

export const routeSegmentSchema = z.object({
  id: z.string().min(1),
  dayId: z.string().min(1),
  fromItemId: z.string().min(1),
  toItemId: z.string().min(1),
  mode: transportKindSchema,
  meters: z.number().min(0),
  minutes: z.number().min(0),
  label: z.string(),
  polyline: z.array(z.tuple([z.number(), z.number()])).optional(),
  estimatedCost: z.number().optional(),
});

export const budgetItemSchema = z.object({
  id: z.string().min(1),
  tripId: z.string().min(1),
  category: budgetCategorySchema,
  label: z.string(),
  planned: z.number().min(0),
  actual: z.number().optional(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  tripId: z.string().min(1),
  dayId: z.string().optional(),
  placeId: z.string().optional(),
  title: z.string().min(1),
  group: z.enum(["before", "day"]),
  status: taskStatusSchema,
  checkin: z.boolean().optional(),
  dueAt: z.string().optional(),
  linkedItemId: z.string().optional(),
});

export const tripSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().optional(),
    title: z.string().min(1),
    destination: z.string().min(1),
    origin: z.string(),
    startDate: isoDate,
    endDate: isoDate,
    travelers: z.number().int().min(1),
    budget: z.number().min(0),
    currency: z.string().default("CNY"),
    status: tripStatusSchema.default("draft"),
    estimatedSpend: z.number().min(0),
    coverImage: z.string(),
    vibe: z.array(z.string()),
    prompt: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    days: z.array(daySchema).min(1),
    items: z.array(itineraryItemSchema),
    segments: z.array(routeSegmentSchema),
    places: z.array(placeSchema),
    hotels: z.array(z.any()).default([]),
    restaurants: z.array(z.any()).default([]),
    activities: z.array(z.any()).default([]),
    transports: z.array(z.any()).default([]),
    tasks: z.array(taskSchema),
    budgetItems: z.array(budgetItemSchema),
  })
  .superRefine((trip, ctx) => {
    const placeIds = new Set(trip.places.map((p) => p.id));
    const dayIds = new Set(trip.days.map((d) => d.id));
    trip.items.forEach((item, i) => {
      if (!placeIds.has(item.placeId)) {
        ctx.addIssue({ code: "custom", message: `item ${i} references unknown place ${item.placeId}`, path: ["items", i, "placeId"] });
      }
      if (!dayIds.has(item.dayId)) {
        ctx.addIssue({ code: "custom", message: `item ${i} references unknown day ${item.dayId}`, path: ["items", i, "dayId"] });
      }
    });
  });

export type TripInput = z.input<typeof tripSchema>;
export type ValidTrip = z.output<typeof tripSchema>;

export function validateTrip(raw: unknown) {
  return tripSchema.safeParse(raw);
}
