export const TRAVEL_ACTION_TYPES = [
  "MOVE_ITEM",
  "REMOVE_ITEM",
  "ADD_ITEM",
  "REPLACE_ITEM",
  "OPTIMIZE_DAY",
  "REDUCE_WALKING",
  "REDUCE_BUDGET",
  "CHANGE_TRANSPORT",
  "RECOMMEND_FOOD",
  "RECOMMEND_PLACES",
  "CHANGE_TIME",
  "CHANGE_DAY",
] as const;

export type TravelActionType = (typeof TRAVEL_ACTION_TYPES)[number];

export interface MoveItemPayload {
  itemId: string;
  toDayId: string;
  order?: number;
}

export interface RemoveItemPayload {
  itemId: string;
}

export interface AddItemPayload {
  placeId: string;
  dayId: string;
  startTime?: string;
  durationMinutes?: number;
}

export interface ReplaceItemPayload {
  itemId: string;
  placeId: string;
}

export interface OptimizeDayPayload {
  dayId: string;
}

export interface ReduceWalkingPayload {
  dayId?: string;
}

export interface ReduceBudgetPayload {
  amount: number;
  reason?: string;
}

export interface ChangeTransportPayload {
  itemId?: string;
  dayId?: string;
  mode: "walk" | "metro" | "taxi" | "bus";
}

export interface RecommendPayload {
  dayId?: string;
  nearPlaceId?: string;
  placeId?: string;
}

export interface ChangeTimePayload {
  itemId: string;
  startTime: string;
}

export type TravelAction =
  | { type: "MOVE_ITEM"; payload: MoveItemPayload }
  | { type: "REMOVE_ITEM"; payload: RemoveItemPayload }
  | { type: "ADD_ITEM"; payload: AddItemPayload }
  | { type: "REPLACE_ITEM"; payload: ReplaceItemPayload }
  | { type: "OPTIMIZE_DAY"; payload: OptimizeDayPayload }
  | { type: "REDUCE_WALKING"; payload: ReduceWalkingPayload }
  | { type: "REDUCE_BUDGET"; payload: ReduceBudgetPayload }
  | { type: "CHANGE_TRANSPORT"; payload: ChangeTransportPayload }
  | { type: "RECOMMEND_FOOD"; payload: RecommendPayload }
  | { type: "RECOMMEND_PLACES"; payload: RecommendPayload }
  | { type: "CHANGE_TIME"; payload: ChangeTimePayload }
  | { type: "CHANGE_DAY"; payload: MoveItemPayload };

export interface ActionExecutionResult {
  trip: import("@/types/travel").Trip;
  applied: TravelAction[];
  rejected: Array<{ action: TravelAction; reason: string }>;
}
