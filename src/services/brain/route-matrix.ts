import { estimateTransit, haversineMeters } from "@/lib/utils";
import { estimateCost } from "@/services/transport/options";
import type { ProviderRoute, TravelDataProvider } from "@/skill/providers";
import type { Place } from "@/types/travel";
import type { RouteMatrix, RouteMatrixEdge } from "@/schemas/brain";

/**
 * Partial Route Matrix (Travel Brain Phase 4.1).
 *
 * Goal: the planner knows A→B time/cost before ordering stops, without an
 * O(N²) burst of realtime provider calls. Strategy:
 *   1. Haversine for every pair (free) as the initial filter.
 *   2. Select "high-value" edges only: each place's K nearest neighbours,
 *      plus edges incident to priority places (must-visit).
 *   3. Query the realtime provider for at most `maxRealEdges` of them.
 *   4. Everything else stays a labeled ESTIMATED edge.
 *   5. Real routes are cached in-process with a TTL and reused across trips
 *      with the same destination (the cache key is city|placeA|placeB|mode).
 */

const DEFAULT_MAX_REAL_EDGES = 8;
const DEFAULT_NEIGHBORS_PER_PLACE = 2;
const DEFAULT_TTL_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 400;

type UrbanMode = "walk" | "metro" | "bus" | "taxi" | "drive";

interface CacheEntry {
  route: ProviderRoute;
  expiresAt: number;
}

const routeCache = new Map<string, CacheEntry>();

/** Test hook: the cache is module-level by design (per-process reuse). */
export function clearRouteMatrixCache() {
  routeCache.clear();
}

function cacheKey(city: string, fromId: string, toId: string, mode: UrbanMode) {
  return `${city}|${fromId}|${toId}|${mode}`;
}

function cacheGet(key: string, now: number) {
  const hit = routeCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    routeCache.delete(key);
    return undefined;
  }
  return hit.route;
}

function cachePut(key: string, route: ProviderRoute, ttlMs: number, now: number) {
  if (routeCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(key, { route, expiresAt: now + ttlMs });
}

function edgeKey(fromId: string, toId: string) {
  return `${fromId}|${toId}`;
}

function estimateEdge(haversineM: number, mode: UrbanMode, travelers: number): Pick<RouteMatrixEdge, "durationMinutes" | "costCny" | "level"> {
  const transit = estimateTransit(haversineM);
  const cost = estimateCost(mode, haversineM, travelers);
  return {
    durationMinutes: transit.minutes,
    costCny: Math.round((cost.min + cost.max) / 2),
    level: "ESTIMATED",
  };
}

export interface BuildRouteMatrixInput {
  city: string;
  /** Matrix is built over these candidates (deduped, finite coordinates). */
  places: Place[];
  provider?: TravelDataProvider;
  /** Mode used for realtime queries; defaults to walk. */
  mode?: UrbanMode;
  /** Places whose incident edges are queried first (must-visit etc.). */
  priorityPlaceIds?: string[];
  maxRealEdges?: number;
  neighborsPerPlace?: number;
  ttlMs?: number;
  travelers?: number;
  now?: number;
}

export interface RouteMatrixResult {
  matrix: RouteMatrix;
  /** Raw provider routes for queried edges, keyed "fromId|toId". */
  realRoutes: Map<string, ProviderRoute>;
}

export async function buildRouteMatrix(input: BuildRouteMatrixInput): Promise<RouteMatrixResult> {
  const mode = input.mode ?? "walk";
  const travelers = Math.max(1, input.travelers ?? 1);
  const maxRealEdges = Math.max(0, input.maxRealEdges ?? DEFAULT_MAX_REAL_EDGES);
  const neighbors = Math.max(1, input.neighborsPerPlace ?? DEFAULT_NEIGHBORS_PER_PLACE);
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const now = input.now ?? Date.now();

  const places = [...new Map(
    input.places
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
      .map((place) => [place.id, place] as const),
  ).values()];

  const distance = new Map<string, number>();
  const pairs: Array<{ a: Place; b: Place; meters: number }> = [];
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const meters = haversineMeters(places[i], places[j]);
      distance.set(edgeKey(places[i].id, places[j].id), meters);
      distance.set(edgeKey(places[j].id, places[i].id), meters);
      pairs.push({ a: places[i], b: places[j], meters });
    }
  }

  // High-value edge selection: K nearest neighbours per place, plus the
  // neighbours of priority (must-visit) places, then keep the closest ones.
  // Pairs are normalized (id-sorted) so A→B and B→A share one entry.
  const priority = new Set(input.priorityPlaceIds ?? []);
  const selected = new Map<string, { a: Place; b: Place; meters: number; priority: boolean }>();
  const consider = (a: Place, b: Place) => {
    const [first, second] = a.id <= b.id ? [a, b] : [b, a];
    const key = edgeKey(first.id, second.id);
    const meters = distance.get(key) ?? haversineMeters(first, second);
    const isPriority = priority.has(first.id) || priority.has(second.id);
    const existing = selected.get(key);
    if (existing) {
      existing.priority = existing.priority || isPriority;
      return;
    }
    selected.set(key, { a: first, b: second, meters, priority: isPriority });
  };
  for (const place of places) {
    const others = places
      .filter((other) => other.id !== place.id)
      .map((other) => ({ other, meters: distance.get(edgeKey(place.id, other.id)) ?? haversineMeters(place, other) }))
      .sort((x, y) => x.meters - y.meters)
      .slice(0, neighbors);
    for (const { other } of others) consider(place, other);
  }
  const prioritized = [...selected.values()].sort((x, y) => {
    if (x.priority !== y.priority) return x.priority ? -1 : 1;
    return x.meters - y.meters;
  });
  const toQuery = prioritized.slice(0, maxRealEdges);

  const realRoutes = new Map<string, ProviderRoute>();
  const realMeta = new Map<string, { durationMinutes: number; costCny: number }>();
  for (const pair of toQuery) {
    try {
      if (!input.provider) throw new Error("no provider");
      const cached = cacheGet(cacheKey(input.city, pair.a.id, pair.b.id, mode), now);
      const route = cached ?? await input.provider.planRoute({
        origin: { lat: pair.a.lat, lng: pair.a.lng },
        destination: { lat: pair.b.lat, lng: pair.b.lng },
        mode,
        city: input.city,
      });
      if (!cached) cachePut(cacheKey(input.city, pair.a.id, pair.b.id, mode), route, ttlMs, now);
      realRoutes.set(edgeKey(pair.a.id, pair.b.id), route);
      const cost = estimateCost(mode, route.distanceMeters, travelers);
      realMeta.set(edgeKey(pair.a.id, pair.b.id), { durationMinutes: route.durationMinutes, costCny: Math.round((cost.min + cost.max) / 2) });
    } catch {
      // Realtime query failed: the edge falls back to the estimated branch below.
    }
  }

  const edges: RouteMatrixEdge[] = pairs.map(({ a, b, meters }) => {
    const forward = edgeKey(a.id, b.id);
    const real = realMeta.get(forward) ?? realMeta.get(edgeKey(b.id, a.id));
    if (real) {
      return {
        fromPlaceId: a.id, toPlaceId: b.id,
        haversineMeters: Math.round(meters),
        durationMinutes: real.durationMinutes,
        mode,
        queried: true,
        level: "REAL",
        costCny: real.costCny,
      };
    }
    const estimated = estimateEdge(meters, mode, travelers);
    return {
      fromPlaceId: a.id, toPlaceId: b.id,
      haversineMeters: Math.round(meters),
      ...estimated,
      mode,
      queried: false,
    };
  });

  const coverage = toQuery.length ? realRoutes.size / toQuery.length : 1;
  return {
    matrix: {
      city: input.city,
      mode,
      edges,
      builtAt: new Date(now).toISOString(),
      coverage,
    },
    realRoutes,
  };
}

/**
 * A previously measured route for a pair, any direction. Only REAL edges are
 * returned — estimated edges must not masquerade as enrichment results.
 */
export function findRealMatrixRoute(
  routes: Map<string, ProviderRoute> | undefined,
  fromPlaceId: string,
  toPlaceId: string,
): ProviderRoute | undefined {
  if (!routes) return undefined;
  return routes.get(edgeKey(fromPlaceId, toPlaceId)) ?? routes.get(edgeKey(toPlaceId, fromPlaceId));
}

/** Nearest-neighbour intel per place, e.g. "最近：长江索道 1.2km/13min[实测]". */
export function routeIntelByPlace(places: Place[], matrix: RouteMatrix): Record<string, string> {
  const nameById = new Map(places.map((place) => [place.id, place.name]));
  const best = new Map<string, { toName: string; meters: number; minutes: number; queried: boolean }>();
  for (const edge of matrix.edges) {
    const fromName = nameById.get(edge.fromPlaceId);
    const toName = nameById.get(edge.toPlaceId);
    if (!fromName || !toName) continue;
    for (const [from, , name] of [[edge.fromPlaceId, edge.toPlaceId, toName], [edge.toPlaceId, edge.fromPlaceId, fromName]] as const) {
      const current = best.get(from);
      if (!current || edge.haversineMeters < current.meters) {
        best.set(from, { toName: name, meters: edge.haversineMeters, minutes: edge.durationMinutes, queried: edge.queried });
      }
    }
  }
  return Object.fromEntries([...best.entries()].map(([placeId, info]) => [
    placeId,
    `最近：${info.toName} ${(info.meters / 1000).toFixed(1)}km/${info.minutes}min${info.queried ? "[实测]" : "[估算]"}`,
  ]));
}

/**
 * Compact route section for the planner prompt: nearest neighbour per place
 * (bounded), isolation warnings for places far from everything else, and a
 * coverage caveat when most edges are estimates.
 */
export function summarizeRouteMatrix(places: Place[], matrix: RouteMatrix, maxPlaces = 24): string {
  const intel = routeIntelByPlace(places.slice(0, maxPlaces), matrix);
  const lines = Object.entries(intel).map(([placeId, text]) => {
    const place = places.find((candidate) => candidate.id === placeId);
    return `${place?.name ?? placeId} ${text}`;
  });
  const isolated = places
    .slice(0, maxPlaces)
    .map((place) => ({ place, info: intel[place.id] }))
    .filter(({ info }) => info?.includes("[估算]"))
    .map(({ place, info }) => ({ place, meters: Number(info?.match(/([\d.]+)km/)?.[1] ?? 0) }))
    .filter(({ meters }) => meters >= 12)
    .slice(0, 3)
    .map(({ place, meters }) => `${place.name} 距其他候选普遍较远（最近约 ${meters.toFixed(1)}km），建议单独安排半天`);
  const parts = [
    "路线情报（[实测]=高德路线，[估算]=直线距离推算；排同一天的地点应尽量相邻）：",
    ...lines,
    ...isolated,
    ...(matrix.coverage < 0.5 ? ["注意：本轮路线情报以直线估算为主，跨区组合请保守。"] : []),
  ];
  return parts.join("\n");
}
