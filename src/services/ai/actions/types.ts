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
  // Phase 3 Extensions
  "RAIN_PLAN",
  "DELAY_DAY",
  "START_EARLIER",
  "SKIP_NEXT",
  "FIND_NEARBY_FOOD",
  "REDUCE_TODAY_WALKING",
  "REDUCE_TODAY_BUDGET",
  "CHANGE_NEXT_PLACE",
  "CHANGE_ROUTE_MODE",
  "MOVE_INDOOR",
  "EXTEND_STAY",
  "SHORTEN_STAY",
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
  maxWalkMeters?: number;
}

export interface ReduceBudgetPayload {
  amount: number;
  reason?: string;
}

export interface ChangeTransportPayload {
  itemId?: string;
  dayId?: string;
  mode: "walk" | "metro" | "taxi" | "bus" | "drive";
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

export interface RainPlanPayload {
  dayId?: string;
  preferIndoor?: boolean;
}

export interface DelayDayPayload {
  dayId: string;
  minutes: number;
}

export interface StartEarlierPayload {
  dayId: string;
  minutes: number;
}

export interface SkipNextPayload {
  dayId: string;
  currentItemId?: string;
}

export interface FindNearbyFoodPayload {
  dayId: string;
  nearItemId?: string;
  nearPlaceId?: string;
  cuisine?: string;
}

export interface ReduceTodayWalkingPayload {
  dayId: string;
  maxWalkMeters?: number;
}

export interface ReduceTodayBudgetPayload {
  dayId: string;
  targetSaveAmount: number;
}

export interface ChangeNextPlacePayload {
  dayId?: string;
  currentItemId?: string;
  replacementPlaceId?: string;
  category?: string;
}

export interface ChangeRouteModePayload {
  segmentId?: string;
  fromItemId?: string;
  toItemId?: string;
  dayId?: string;
  newMode: "walk" | "metro" | "taxi" | "bus" | "drive";
}

export interface MoveIndoorPayload {
  dayId: string;
  outdoorItemId?: string;
}

export interface ExtendStayPayload {
  itemId: string;
  additionalMinutes: number;
}

export interface ShortenStayPayload {
  itemId: string;
  reduceMinutes: number;
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
  | { type: "CHANGE_DAY"; payload: MoveItemPayload }
  // Phase 3 Actions
  | { type: "RAIN_PLAN"; payload: RainPlanPayload }
  | { type: "DELAY_DAY"; payload: DelayDayPayload }
  | { type: "START_EARLIER"; payload: StartEarlierPayload }
  | { type: "SKIP_NEXT"; payload: SkipNextPayload }
  | { type: "FIND_NEARBY_FOOD"; payload: FindNearbyFoodPayload }
  | { type: "REDUCE_TODAY_WALKING"; payload: ReduceTodayWalkingPayload }
  | { type: "REDUCE_TODAY_BUDGET"; payload: ReduceTodayBudgetPayload }
  | { type: "CHANGE_NEXT_PLACE"; payload: ChangeNextPlacePayload }
  | { type: "CHANGE_ROUTE_MODE"; payload: ChangeRouteModePayload }
  | { type: "MOVE_INDOOR"; payload: MoveIndoorPayload }
  | { type: "EXTEND_STAY"; payload: ExtendStayPayload }
  | { type: "SHORTEN_STAY"; payload: ShortenStayPayload };

export interface ActionExecutionResult {
  trip: import("@/types/travel").Trip;
  applied: TravelAction[];
  rejected: Array<{ action: TravelAction; reason: string }>;
}
