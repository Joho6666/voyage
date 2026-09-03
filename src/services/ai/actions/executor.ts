import { uid } from "@/lib/utils";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import type { BudgetCategory, ItineraryItem, Trip } from "@/types/travel";
import type {
  ActionExecutionResult,
  TravelAction,
} from "./types";

function findItem(trip: Trip, itemId: string) {
  return trip.items.find((item) => item.id === itemId);
}

function nextOrder(trip: Trip, dayId: string) {
  return trip.items.filter((item) => item.dayId === dayId).length;
}

function addItem(trip: Trip, payload: { placeId: string; dayId: string; startTime?: string; durationMinutes?: number }): Trip {
  const place = trip.places.find((p) => p.id === payload.placeId);
  if (!place) return trip;
  if (trip.items.some((i) => i.dayId === payload.dayId && i.placeId === payload.placeId)) return trip;
  const type =
    place.category === "food" || place.category === "cafe"
      ? "food"
      : place.category === "hotel"
        ? "hotel"
        : place.category === "activity"
          ? "activity"
          : place.category === "transport"
            ? "transport"
            : "place";
  const item: ItineraryItem = {
    id: uid("it"),
    dayId: payload.dayId,
    type,
    placeId: place.id,
    startTime: payload.startTime ?? "18:00",
    duration: payload.durationMinutes ?? place.stayMinutes ?? 60,
    order: nextOrder(trip, payload.dayId),
    status: "planned",
  };
  return recomputeDay({ ...trip, items: [...trip.items, item] }, payload.dayId);
}

/** Greedy nearest-neighbour reorder of a day to cut backtracking. */
function optimizeDay(trip: Trip, dayId: string): Trip {
  const items = trip.items
    .filter((i) => i.dayId === dayId)
    .sort((a, b) => a.order - b.order);
  if (items.length < 3) return trip;
  const coords = new Map(trip.places.map((p) => [p.id, { lat: p.lat, lng: p.lng }]));
  const remaining = [...items];
  const ordered: ItineraryItem[] = [];
  let cursor = remaining.shift();
  if (!cursor) return trip;
  ordered.push(cursor);
  while (remaining.length) {
    const from = coords.get(cursor.placeId);
    if (!from) break;
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const to = coords.get(candidate.placeId);
      if (!to) return;
      const d = (to.lat - from.lat) ** 2 + (to.lng - from.lng) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = index;
      }
    });
    cursor = remaining.splice(bestIdx, 1)[0];
    ordered.push(cursor);
  }
  const orderedIds = ordered.map((item) => item.id);
  const itemsWithOrder = trip.items.map((item) => {
    if (item.dayId !== dayId) return item;
    const idx = orderedIds.indexOf(item.id);
    return idx === -1 ? item : { ...item, order: idx };
  });
  return recomputeDay({ ...trip, items: itemsWithOrder }, dayId);
}

function reduceWalking(trip: Trip, dayId?: string): Trip {
  const segments = trip.segments.map((segment) => {
    if (dayId && segment.dayId !== dayId) return segment;
    if (segment.mode === "walk" && segment.meters > 1200) {
      return { ...segment, mode: segment.meters > 3500 ? ("taxi" as const) : ("metro" as const), label: segment.meters > 3500 ? "出租" : "地铁" };
    }
    return segment;
  });
  return { ...trip, segments };
}

function reduceBudget(trip: Trip, amount: number): Trip {
  const target = Math.max(0, trip.estimatedSpend - amount);
  const pool = trip.budgetItems.filter((item) => item.category !== "transport");
  const poolTotal = pool.reduce((sum, item) => sum + item.planned, 0);
  const cut = trip.estimatedSpend - target;
  const budgetItems = trip.budgetItems.map((item) => {
    if (!pool.some((p) => p.id === item.id) || poolTotal === 0) return item;
    const share = (item.planned / poolTotal) * cut;
    return { ...item, planned: Math.max(0, Math.round(item.planned - share)) };
  });
  return { ...trip, estimatedSpend: target, budgetItems };
}

function changeTransport(trip: Trip, payload: { itemId?: string; dayId?: string; mode: "walk" | "metro" | "taxi" | "bus" }): Trip {
  const labels: Record<string, string> = { walk: "步行", metro: "地铁", taxi: "出租", bus: "公交" };
  const segments = trip.segments.map((segment) => {
    if (payload.itemId && segment.fromItemId !== payload.itemId) return segment;
    if (payload.dayId && segment.dayId !== payload.dayId) return segment;
    return { ...segment, mode: payload.mode, label: labels[payload.mode] ?? segment.label };
  });
  return { ...trip, segments };
}

export function executeActions(trip: Trip, actions: TravelAction[]): ActionExecutionResult {
  let current = structuredClone(trip);
  const applied: TravelAction[] = [];
  const rejected: Array<{ action: TravelAction; reason: string }> = [];

  for (const action of actions) {
    const before = current;
    try {
      switch (action.type) {
        case "MOVE_ITEM":
        case "CHANGE_DAY": {
          const item = findItem(current, action.payload.itemId);
          if (!item) {
            rejected.push({ action, reason: `item ${action.payload.itemId} not found` });
            continue;
          }
          if (!current.days.some((d) => d.id === action.payload.toDayId)) {
            rejected.push({ action, reason: `day ${action.payload.toDayId} not found` });
            continue;
          }
          const fromDay = item.dayId;
          const order = action.payload.order ?? nextOrder(current, action.payload.toDayId);
          current = {
            ...current,
            items: current.items.map((i) =>
              i.id === action.payload.itemId ? { ...i, dayId: action.payload.toDayId, order } : i,
            ),
          };
          current = recomputeDay(current, fromDay);
          current = recomputeDay(current, action.payload.toDayId);
          break;
        }
        case "REMOVE_ITEM": {
          const item = findItem(current, action.payload.itemId);
          if (!item) {
            rejected.push({ action, reason: `item ${action.payload.itemId} not found` });
            continue;
          }
          current = recomputeDay(
            { ...current, items: current.items.filter((i) => i.id !== action.payload.itemId) },
            item.dayId,
          );
          break;
        }
        case "ADD_ITEM": {
          if (!current.places.some((p) => p.id === action.payload.placeId)) {
            rejected.push({ action, reason: `place ${action.payload.placeId} not found` });
            continue;
          }
          if (!current.days.some((d) => d.id === action.payload.dayId)) {
            rejected.push({ action, reason: `day ${action.payload.dayId} not found` });
            continue;
          }
          current = addItem(current, action.payload);
          break;
        }
        case "REPLACE_ITEM": {
          const item = findItem(current, action.payload.itemId);
          const place = current.places.find((p) => p.id === action.payload.placeId);
          if (!item || !place) {
            rejected.push({ action, reason: "item or replacement place not found" });
            continue;
          }
          current = recomputeDay(
            {
              ...current,
              items: current.items.map((i) =>
                i.id === item.id
                  ? { ...i, placeId: place.id, duration: place.stayMinutes || i.duration }
                  : i,
              ),
            },
            item.dayId,
          );
          break;
        }
        case "OPTIMIZE_DAY": {
          if (!current.days.some((d) => d.id === action.payload.dayId)) {
            rejected.push({ action, reason: `day ${action.payload.dayId} not found` });
            continue;
          }
          current = optimizeDay(current, action.payload.dayId);
          break;
        }
        case "REDUCE_WALKING": {
          current = reduceWalking(current, action.payload.dayId);
          break;
        }
        case "REDUCE_BUDGET": {
          current = reduceBudget(current, action.payload.amount);
          break;
        }
        case "CHANGE_TRANSPORT": {
          current = changeTransport(current, action.payload);
          break;
        }
        case "RECOMMEND_FOOD": {
          const dayId = action.payload.dayId ?? current.days[0]?.id;
          const food = current.places.find(
            (p) => (p.category === "food" || p.category === "cafe") && !current.items.some((i) => i.placeId === p.id),
          );
          if (!dayId || !food) {
            rejected.push({ action, reason: "no unvisited food place available" });
            continue;
          }
          current = addItem(current, { placeId: food.id, dayId });
          break;
        }
        case "RECOMMEND_PLACES": {
          const dayId = action.payload.dayId ?? current.days[0]?.id;
          const place = current.places.find(
            (p) => p.category === "attraction" && !current.items.some((i) => i.placeId === p.id),
          );
          if (!dayId || !place) {
            rejected.push({ action, reason: "no unvisited attraction available" });
            continue;
          }
          current = addItem(current, { placeId: place.id, dayId });
          break;
        }
        case "CHANGE_TIME": {
          const item = findItem(current, action.payload.itemId);
          if (!item) {
            rejected.push({ action, reason: `item ${action.payload.itemId} not found` });
            continue;
          }
          current = recomputeDay(
            {
              ...current,
              items: current.items.map((i) =>
                i.id === item.id ? { ...i, startTime: action.payload.startTime } : i,
              ),
            },
            item.dayId,
          );
          break;
        }
        default:
          rejected.push({ action, reason: "unsupported action" });
      }
      if (current !== before) applied.push(action);
    } catch (error) {
      rejected.push({ action, reason: error instanceof Error ? error.message : "execution failed" });
    }
  }

  current = recomputeTrip(current);
  return { trip: current, applied, rejected };
}

export function estimateBudgetItems(trip: Trip): Trip {
  const perTravelerFood = 180 * trip.days.length;
  const categoryPlan: Array<[BudgetCategory, number]> = [
    ["transport", Math.round(trip.estimatedSpend * 0.28)],
    ["stay", Math.round(trip.estimatedSpend * 0.3)],
    ["food", perTravelerFood * trip.travelers],
    ["ticket", Math.round(trip.estimatedSpend * 0.08)],
    ["shop", 100],
    ["other", 60],
  ];
  return {
    ...trip,
    budgetItems: categoryPlan.map(([category, planned], index) => ({
      id: trip.budgetItems[index]?.id ?? uid("b"),
      tripId: trip.id,
      category,
      label: trip.budgetItems[index]?.label ?? category,
      planned,
    })),
  };
}
