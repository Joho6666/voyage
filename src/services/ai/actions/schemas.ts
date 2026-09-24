import { z } from "zod";
import { TRAVEL_ACTION_TYPES } from "./types";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");

export const moveItemPayloadSchema = z.object({
  itemId: z.string().min(1),
  toDayId: z.string().min(1),
  order: z.number().int().min(0).optional(),
});

export const removeItemPayloadSchema = z.object({
  itemId: z.string().min(1),
});

export const addItemPayloadSchema = z.object({
  placeId: z.string().min(1),
  dayId: z.string().min(1),
  startTime: hhmm.optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
});

export const replaceItemPayloadSchema = z.object({
  itemId: z.string().min(1),
  placeId: z.string().min(1),
});

export const optimizeDayPayloadSchema = z.object({
  dayId: z.string().min(1),
});

export const reduceWalkingPayloadSchema = z.object({
  dayId: z.string().min(1).optional(),
  maxWalkMeters: z.number().int().positive().optional(),
});

export const reduceBudgetPayloadSchema = z.object({
  amount: z.number().positive().max(100000),
  reason: z.string().optional(),
});

export const changeTransportPayloadSchema = z.object({
  itemId: z.string().optional(),
  dayId: z.string().optional(),
  mode: z.enum(["walk", "metro", "taxi", "bus", "drive"]),
});

export const recommendPayloadSchema = z.object({
  dayId: z.string().optional(),
  nearPlaceId: z.string().optional(),
  placeId: z.string().optional(),
});

export const changeTimePayloadSchema = z.object({
  itemId: z.string().min(1),
  startTime: hhmm,
});

// Phase 3 Action Schemas
export const rainPlanPayloadSchema = z.object({
  dayId: z.string().optional(),
  preferIndoor: z.boolean().optional(),
});

export const delayDayPayloadSchema = z.object({
  dayId: z.string().min(1),
  minutes: z.number().int().min(5).max(360),
});

export const startEarlierPayloadSchema = z.object({
  dayId: z.string().min(1),
  minutes: z.number().int().min(5).max(360),
});

export const skipNextPayloadSchema = z.object({
  dayId: z.string().min(1),
  currentItemId: z.string().optional(),
});

export const findNearbyFoodPayloadSchema = z.object({
  dayId: z.string().min(1),
  nearItemId: z.string().optional(),
  nearPlaceId: z.string().optional(),
  cuisine: z.string().optional(),
});

export const reduceTodayWalkingPayloadSchema = z.object({
  dayId: z.string().min(1),
  maxWalkMeters: z.number().int().positive().optional(),
});

export const reduceTodayBudgetPayloadSchema = z.object({
  dayId: z.string().min(1),
  targetSaveAmount: z.number().positive().max(10000),
});

export const changeNextPlacePayloadSchema = z.object({
  dayId: z.string().optional(),
  currentItemId: z.string().optional(),
  replacementPlaceId: z.string().optional(),
  category: z.string().optional(),
});

export const changeRouteModePayloadSchema = z.object({
  segmentId: z.string().optional(),
  fromItemId: z.string().optional(),
  toItemId: z.string().optional(),
  dayId: z.string().optional(),
  newMode: z.enum(["walk", "metro", "taxi", "bus", "drive"]),
});

export const moveIndoorPayloadSchema = z.object({
  dayId: z.string().min(1),
  outdoorItemId: z.string().optional(),
});

export const extendStayPayloadSchema = z.object({
  itemId: z.string().min(1),
  additionalMinutes: z.number().int().min(5).max(240),
});

export const shortenStayPayloadSchema = z.object({
  itemId: z.string().min(1),
  reduceMinutes: z.number().int().min(5).max(240),
});

export const travelActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MOVE_ITEM"), payload: moveItemPayloadSchema }),
  z.object({ type: z.literal("REMOVE_ITEM"), payload: removeItemPayloadSchema }),
  z.object({ type: z.literal("ADD_ITEM"), payload: addItemPayloadSchema }),
  z.object({ type: z.literal("REPLACE_ITEM"), payload: replaceItemPayloadSchema }),
  z.object({ type: z.literal("OPTIMIZE_DAY"), payload: optimizeDayPayloadSchema }),
  z.object({ type: z.literal("REDUCE_WALKING"), payload: reduceWalkingPayloadSchema }),
  z.object({ type: z.literal("REDUCE_BUDGET"), payload: reduceBudgetPayloadSchema }),
  z.object({ type: z.literal("CHANGE_TRANSPORT"), payload: changeTransportPayloadSchema }),
  z.object({ type: z.literal("RECOMMEND_FOOD"), payload: recommendPayloadSchema }),
  z.object({ type: z.literal("RECOMMEND_PLACES"), payload: recommendPayloadSchema }),
  z.object({ type: z.literal("CHANGE_TIME"), payload: changeTimePayloadSchema }),
  z.object({ type: z.literal("CHANGE_DAY"), payload: moveItemPayloadSchema }),
  // Phase 3 Schemas
  z.object({ type: z.literal("RAIN_PLAN"), payload: rainPlanPayloadSchema }),
  z.object({ type: z.literal("DELAY_DAY"), payload: delayDayPayloadSchema }),
  z.object({ type: z.literal("START_EARLIER"), payload: startEarlierPayloadSchema }),
  z.object({ type: z.literal("SKIP_NEXT"), payload: skipNextPayloadSchema }),
  z.object({ type: z.literal("FIND_NEARBY_FOOD"), payload: findNearbyFoodPayloadSchema }),
  z.object({ type: z.literal("REDUCE_TODAY_WALKING"), payload: reduceTodayWalkingPayloadSchema }),
  z.object({ type: z.literal("REDUCE_TODAY_BUDGET"), payload: reduceTodayBudgetPayloadSchema }),
  z.object({ type: z.literal("CHANGE_NEXT_PLACE"), payload: changeNextPlacePayloadSchema }),
  z.object({ type: z.literal("CHANGE_ROUTE_MODE"), payload: changeRouteModePayloadSchema }),
  z.object({ type: z.literal("MOVE_INDOOR"), payload: moveIndoorPayloadSchema }),
  z.object({ type: z.literal("EXTEND_STAY"), payload: extendStayPayloadSchema }),
  z.object({ type: z.literal("SHORTEN_STAY"), payload: shortenStayPayloadSchema }),
]);

export const travelActionListSchema = z.object({
  actions: z.array(travelActionSchema).min(1).max(20),
  summary: z.string().optional(),
});

export type TravelActionList = z.output<typeof travelActionListSchema>;

export function isTravelActionType(value: string): value is (typeof TRAVEL_ACTION_TYPES)[number] {
  return (TRAVEL_ACTION_TYPES as readonly string[]).includes(value);
}
