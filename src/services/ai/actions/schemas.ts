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
});

export const reduceBudgetPayloadSchema = z.object({
  amount: z.number().positive().max(100000),
  reason: z.string().optional(),
});

export const changeTransportPayloadSchema = z.object({
  itemId: z.string().optional(),
  dayId: z.string().optional(),
  mode: z.enum(["walk", "metro", "taxi", "bus"]),
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
]);

export const travelActionListSchema = z.object({
  actions: z.array(travelActionSchema).min(1).max(12),
  summary: z.string().optional(),
});

export type TravelActionList = z.output<typeof travelActionListSchema>;

export function isTravelActionType(value: string): value is (typeof TRAVEL_ACTION_TYPES)[number] {
  return (TRAVEL_ACTION_TYPES as readonly string[]).includes(value);
}
