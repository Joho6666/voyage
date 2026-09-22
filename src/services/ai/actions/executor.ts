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

function addMinutesToHhmm(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
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
    if (cursor) ordered.push(cursor);
  }
  const orderedIds = ordered.map((item) => item.id);
  const itemsWithOrder = trip.items.map((item) => {
    if (item.dayId !== dayId) return item;
    const idx = orderedIds.indexOf(item.id);
    return idx === -1 ? item : { ...item, order: idx };
  });
  return recomputeDay({ ...trip, items: itemsWithOrder }, dayId);
}

function reduceWalking(trip: Trip, dayId?: string, maxWalkMeters = 1000): Trip {
  const segments = trip.segments.map((segment) => {
    if (dayId && segment.dayId !== dayId) return segment;
    const dist = segment.distanceMeters || segment.meters || 0;
    if (segment.mode === "walk" && dist > maxWalkMeters) {
      const isLong = dist > 3000;
      return {
        ...segment,
        mode: isLong ? ("taxi" as const) : ("metro" as const),
        label: isLong ? "出租" : "地铁",
        estimated: true,
      };
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

function changeTransport(
  trip: Trip,
  payload: {
    itemId?: string;
    dayId?: string;
    segmentId?: string;
    mode: "walk" | "metro" | "taxi" | "bus" | "drive";
  },
): Trip {
  const labels: Record<string, string> = { walk: "步行", metro: "地铁", taxi: "出租", bus: "公交", drive: "自驾" };
  const segments = trip.segments.map((segment) => {
    if (payload.segmentId && segment.id !== payload.segmentId) return segment;
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
          current = reduceWalking(current, action.payload.dayId, action.payload.maxWalkMeters);
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
        // Phase 3 Actions
        case "RAIN_PLAN": {
          const targetDayId =
            action.payload.dayId ??
            current.days.find((d) => d.weather.condition.includes("雨") || d.weather.icon === "rain")?.id ??
            current.days[0]?.id;

          if (!targetDayId) {
            rejected.push({ action, reason: "target day not found" });
            continue;
          }

          // Find candidate indoor places (museum, culture, indoor tea) not already in this day
          const indoorCandidate = current.places.find(
            (p) =>
              (p.name.includes("博物馆") ||
                p.name.includes("文创") ||
                p.name.includes("美术馆") ||
                p.tags.some((t) => t.includes("室内") || t.includes("文化"))) &&
              !current.items.some((i) => i.dayId === targetDayId && i.placeId === p.id),
          );

          // Find outdoor items in this day
          const dayItems = current.items.filter((i) => i.dayId === targetDayId && i.status === "planned");
          const outdoorItem = dayItems.find((i) => {
            const p = current.places.find((pl) => pl.id === i.placeId);
            return (
              p &&
              (p.name.includes("桥") ||
                p.name.includes("步道") ||
                p.name.includes("巷") ||
                p.name.includes("山") ||
                p.name.includes("江") ||
                p.category === "attraction")
            );
          });

          if (outdoorItem && indoorCandidate) {
            // Replace outdoor item with indoor museum/gallery
            current = {
              ...current,
              items: current.items.map((i) =>
                i.id === outdoorItem.id
                  ? { ...i, placeId: indoorCandidate.id, duration: indoorCandidate.stayMinutes || 90 }
                  : i,
              ),
            };
          }

          // Cut long walks in the rain to taxi/metro
          current = reduceWalking(current, targetDayId, 600);
          current = recomputeDay(current, targetDayId);
          break;
        }
        case "DELAY_DAY": {
          const dayId = action.payload.dayId;
          const minutes = action.payload.minutes;
          if (!current.days.some((d) => d.id === dayId)) {
            rejected.push({ action, reason: `day ${dayId} not found` });
            continue;
          }
          current = {
            ...current,
            items: current.items.map((item) => {
              if (item.dayId !== dayId) return item;
              return {
                ...item,
                startTime: addMinutesToHhmm(item.startTime, minutes),
              };
            }),
          };
          current = recomputeDay(current, dayId);
          break;
        }
        case "START_EARLIER": {
          const dayId = action.payload.dayId;
          const minutes = -action.payload.minutes;
          if (!current.days.some((d) => d.id === dayId)) {
            rejected.push({ action, reason: `day ${dayId} not found` });
            continue;
          }
          current = {
            ...current,
            items: current.items.map((item) => {
              if (item.dayId !== dayId) return item;
              return {
                ...item,
                startTime: addMinutesToHhmm(item.startTime, minutes),
              };
            }),
          };
          current = recomputeDay(current, dayId);
          break;
        }
        case "SKIP_NEXT": {
          const dayId = action.payload.dayId;
          const dayItems = current.items.filter((i) => i.dayId === dayId).sort((a, b) => a.order - b.order);
          const targetItem = action.payload.currentItemId
            ? dayItems.find((i) => i.id === action.payload.currentItemId)
            : dayItems.find((i) => i.status !== "done");

          if (!targetItem) {
            rejected.push({ action, reason: "no pending item to skip" });
            continue;
          }

          current = recomputeDay(
            {
              ...current,
              items: current.items.filter((i) => i.id !== targetItem.id),
            },
            dayId,
          );
          break;
        }
        case "FIND_NEARBY_FOOD": {
          const dayId = action.payload.dayId;
          const food = current.places.find(
            (p) =>
              (p.category === "food" || p.category === "cafe") &&
              !current.items.some((i) => i.dayId === dayId && i.placeId === p.id),
          );
          if (!food) {
            rejected.push({ action, reason: "no unvisited food POI found" });
            continue;
          }
          current = addItem(current, {
            placeId: food.id,
            dayId,
            startTime: "12:30",
            durationMinutes: 60,
          });
          break;
        }
        case "REDUCE_TODAY_WALKING": {
          const dayId = action.payload.dayId;
          const maxMeters = action.payload.maxWalkMeters ?? 800;
          current = reduceWalking(current, dayId, maxMeters);
          current = recomputeDay(current, dayId);
          break;
        }
        case "REDUCE_TODAY_BUDGET": {
          const dayId = action.payload.dayId;
          const amount = action.payload.targetSaveAmount;
          // Switch taxis to metro on this day
          current = changeTransport(current, { dayId, mode: "metro" });
          current = reduceBudget(current, amount);
          current = recomputeDay(current, dayId);
          break;
        }
        case "CHANGE_NEXT_PLACE": {
          const dayId = action.payload.dayId ?? current.days[0]?.id;
          if (!dayId) {
            rejected.push({ action, reason: "dayId not found" });
            continue;
          }
          const dayItems = current.items.filter((i) => i.dayId === dayId).sort((a, b) => a.order - b.order);
          const target = action.payload.currentItemId
            ? dayItems.find((i) => i.id === action.payload.currentItemId)
            : dayItems.find((i) => i.status !== "done");

          if (!target) {
            rejected.push({ action, reason: "no pending item to change" });
            continue;
          }

          const altPlace = action.payload.replacementPlaceId
            ? current.places.find((p) => p.id === action.payload.replacementPlaceId)
            : current.places.find(
                (p) =>
                  !current.items.some((i) => i.placeId === p.id) &&
                  (action.payload.category ? p.category === action.payload.category : true),
              );

          if (!altPlace) {
            rejected.push({ action, reason: "no alternate place found" });
            continue;
          }

          current = recomputeDay(
            {
              ...current,
              items: current.items.map((i) =>
                i.id === target.id
                  ? { ...i, placeId: altPlace.id, duration: altPlace.stayMinutes || i.duration }
                  : i,
              ),
            },
            dayId,
          );
          break;
        }
        case "CHANGE_ROUTE_MODE": {
          current = changeTransport(current, {
            segmentId: action.payload.segmentId,
            itemId: action.payload.fromItemId,
            dayId: action.payload.dayId,
            mode: action.payload.newMode,
          });
          break;
        }
        case "MOVE_INDOOR": {
          const dayId = action.payload.dayId;
          const indoorPlace = current.places.find(
            (p) =>
              (p.name.includes("馆") || p.tags.some((t) => t.includes("室内"))) &&
              !current.items.some((i) => i.dayId === dayId && i.placeId === p.id),
          );
          if (!indoorPlace) {
            rejected.push({ action, reason: "no indoor place found" });
            continue;
          }
          const dayItems = current.items.filter((i) => i.dayId === dayId);
          const targetItem = action.payload.outdoorItemId
            ? dayItems.find((i) => i.id === action.payload.outdoorItemId)
            : dayItems[0];
          if (targetItem) {
            current = recomputeDay(
              {
                ...current,
                items: current.items.map((i) =>
                  i.id === targetItem.id ? { ...i, placeId: indoorPlace.id, duration: indoorPlace.stayMinutes || 90 } : i,
                ),
              },
              dayId,
            );
          }
          break;
        }
        case "EXTEND_STAY": {
          const item = findItem(current, action.payload.itemId);
          if (!item) {
            rejected.push({ action, reason: `item ${action.payload.itemId} not found` });
            continue;
          }
          current = recomputeDay(
            {
              ...current,
              items: current.items.map((i) =>
                i.id === item.id ? { ...i, duration: i.duration + action.payload.additionalMinutes } : i,
              ),
            },
            item.dayId,
          );
          break;
        }
        case "SHORTEN_STAY": {
          const item = findItem(current, action.payload.itemId);
          if (!item) {
            rejected.push({ action, reason: `item ${action.payload.itemId} not found` });
            continue;
          }
          const nextDur = Math.max(15, item.duration - action.payload.reduceMinutes);
          current = recomputeDay(
            {
              ...current,
              items: current.items.map((i) =>
                i.id === item.id ? { ...i, duration: nextDur } : i,
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
    ["stay", Math.round(trip.estimatedSpend * 0.35)],
    ["food", Math.min(Math.round(trip.estimatedSpend * 0.25), perTravelerFood * trip.travelers)],
    ["ticket", Math.round(trip.estimatedSpend * 0.08)],
    ["shop", Math.round(trip.estimatedSpend * 0.02)],
    ["other", Math.round(trip.estimatedSpend * 0.02)],
  ];
  const budgetItems = categoryPlan.map(([category, planned]) => ({
    id: uid(`b-${category}`),
    tripId: trip.id,
    category,
    label:
      category === "transport"
        ? "往返与市内交通"
        : category === "stay"
          ? "住宿预估"
          : category === "food"
            ? "餐饮美食"
            : category === "ticket"
              ? "景点门票"
              : category === "shop"
                ? "特产购物"
                : "备用金",
    planned,
  }));
  return { ...trip, budgetItems };
}
