import path from "node:path";
import { createHash } from "node:crypto";
import { executeActions, estimateBudgetItems } from "@/services/ai/actions/executor";
import type { TravelAction } from "@/services/ai/actions/types";
import { buildRouteOptionSet } from "@/services/transport/options";
import { retrieveTravelKnowledgeHybrid } from "@/services/knowledge/hybrid-retriever";
import { buildTransportKnowledgeContext } from "@/services/knowledge/context-builder";
import type { ScoredTransportOption, TransportContext } from "@/types/transport-intelligence";
import { planActionsWithRules, resolveRequestedDay } from "@/services/ai/actions/rule-planner";
import { computeTripChangeSet } from "@/services/ai/diff";
import { optimizeTripPlan } from "@/services/itinerary-optimizer";
import { buildTodayContext } from "@/services/today/context";
import { haversineMeters, estimateTransit } from "@/lib/utils";
import { createTripId } from "@/services/planning/rule-planner";
import { planOutline } from "@/services/planning/outline-planner";
import {
  buildRouteMatrix,
  findRealMatrixRoute,
  routeIntelByPlace,
  summarizeRouteMatrix,
} from "@/services/brain/route-matrix";
import {
  evaluateOutline,
  placeMatchesTerm as brainPlaceMatchesTerm,
  repairOutline,
} from "@/services/brain/constraints";
import type { BrainMetadata, RouteMatrix } from "@/schemas/brain";
import {
  alignPlanningDays,
  filterPlanningCandidates,
  planningProfileToPrompt,
} from "@/services/planning/profile";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import { weatherForDate } from "@/services/weather/merge";
import type { Day, ItineraryItem, Place, RouteSegment, TaskStatus, Trip } from "@/types/travel";
import type { PlanningProfile } from "@/schemas/planning";
import {
  applyChangeInputSchema,
  createTripInputSchema,
  getPlaceInputSchema,
  getSocialEvidenceInputSchema,
  getSocialTrendingInputSchema,
  getTripInputSchema,
  getWeatherInputSchema,
  getRouteOptionsInputSchema,
  optimizeTransportInputSchema,
  optimizeItineraryInputSchema,
  getTodayContextInputSchema,
  retrieveTravelKnowledgeInputSchema,
  replanTripInputSchema,
  searchFlightsInputSchema,
  searchSocialInputSchema,
  searchTravelOffersInputSchema,
  refreshTravelOffersInputSchema,
  planRouteInputSchema,
  proposeChangeInputSchema,
  searchPlacesInputSchema,
  reorderDayInputSchema,
  addPlaceItemInputSchema,
  setItemStatusInputSchema,
  removeItemInputSchema,
  removeDayInputSchema,
  importRouteInputSchema,
  setTaskStatusInputSchema,
  addPlaceInputSchema,
  restoreTripInputSchema,
  updateTripInputSchema,
  successEnvelope,
  type ProviderLevel,
  type ProviderStatus,
  type SkillCommand,
} from "./contracts";
import { normalizeProviderError, SkillError } from "./errors";
import { providerFromEnvironment, type ProviderForecast, type ProviderRoute, type TravelDataProvider } from "./providers";
import { JsonSkillRepository } from "./repository";
import { createFliggyTopClient } from "@/services/booking/fliggy-top";
import { queryMeituan } from "@/services/meituan/runner";
import { queryFliggyOffers } from "@/services/booking/fliggy-offers";
import type { OfferKind, OfferProviderLevel, OfferProviderStatus, TravelOffer } from "@/types/offers";
import { resolveCityCoverImage } from "@/services/media/city-cover";
import { SocialProviderRouter } from "@/services/social/router";
import { createTikHubProvider } from "@/services/social/tikhub";
import { extractSocialSignals } from "@/services/social/signal-extractor";
import { logger } from "@/lib/logger";
import { resolveSourceLink } from "@/services/social/source-link";
import { buildSocialContext } from "@/services/social/context-builder";
import type { SocialEvidence, SocialObservation, SocialPlatform, SocialProviderStatus } from "@/services/social/types";

const DAY_MS = 86_400_000;

function endDate(startDate: string, days: number) {
  return new Date(new Date(`${startDate}T12:00:00Z`).getTime() + (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(startDate: string, finishDate: string) {
  return Math.max(1, Math.min(7, Math.floor((new Date(`${finishDate}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) / DAY_MS) + 1));
}

function preferredRouteMode(profile?: PlanningProfile): "walk" | "metro" | "bus" | "taxi" | "drive" | undefined {
  switch (profile?.transportPreference) {
    case "walk": return "walk";
    case "metro": return "metro";
    case "bus": return "bus";
    case "taxi": return "taxi";
    case "drive": return "drive";
    case "public": return "metro";
    default: return undefined;
  }
}

function placeMatchesTerm(place: Place, term: string) {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return false;
  return [place.name, place.address, place.district, place.description, ...place.tags]
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

function planningConstraintWarnings(profile: PlanningProfile | undefined, providerCandidates: Place[], selectedCandidates: Place[]) {
  if (!profile) return [];
  const warnings: string[] = [];
  const unmatchedMust = profile.mustVisit.filter((term) => !providerCandidates.some((place) => placeMatchesTerm(place, term)));
  if (unmatchedMust.length) warnings.push(`未能在 provider 候选中匹配必去地点：${unmatchedMust.join("、")}`);
  const matchedAvoid = profile.avoid.filter((term) => providerCandidates.some((place) => placeMatchesTerm(place, term)));
  if (matchedAvoid.length && selectedCandidates.some((place) => matchedAvoid.some((term) => placeMatchesTerm(place, term)))) {
    warnings.push("部分避开条件未能从候选地点元数据中完全排除");
  }
  if (profile.dietary.length && !providerCandidates.some((place) => profile.dietary.some((term) => placeMatchesTerm(place, term)))) {
    warnings.push(`provider 未提供可验证的饮食匹配：${profile.dietary.join("、")}`);
  }
  if (profile.accessibility !== undefined && !providerCandidates.some((place) => /无障碍|轮椅|电梯|accessible|elevator/i.test([place.name, place.description, ...place.tags].join(" ")))) {
    warnings.push("provider 未提供可验证的无障碍设施信息");
  }
  if (!selectedCandidates.length) warnings.push("旅行画像过滤后没有可用的 provider 候选，未生成地点替代品");
  return warnings;
}

function overall(levels: ProviderLevel[]): ProviderLevel {
  if (levels.includes("UNAVAILABLE")) return "UNAVAILABLE";
  if (levels.includes("UNSTRUCTURED")) return "UNSTRUCTURED";
  if (levels.includes("PERMISSION_REQUIRED")) return "PERMISSION_REQUIRED";
  if (levels.includes("MOCK")) return "MOCK";
  if (levels.includes("UNKNOWN")) return "UNKNOWN";
  if (levels.includes("ESTIMATED")) return "ESTIMATED";
  if (levels.includes("CACHED")) return "CACHED";
  if (levels.includes("CURATED")) return "CURATED";
  if (levels.includes("SOCIAL")) return "SOCIAL";
  return "REAL";
}

function status(places: ProviderLevel, routes: ProviderLevel, weather: ProviderLevel, travelOffers?: ProviderLevel, social?: ProviderLevel, knowledge?: ProviderLevel): ProviderStatus {
  return {
    overall: overall([places, routes, weather, ...(travelOffers ? [travelOffers] : []), ...(social ? [social] : []), ...(knowledge ? [knowledge] : [])]),
    places, routes, weather,
    travelOffers: travelOffers ?? "UNKNOWN",
    social: social ?? "UNKNOWN",
    knowledge: knowledge ?? "UNKNOWN",
  };
}

function routeLevel(route: ProviderRoute | undefined): ProviderLevel {
  if (!route) return "UNKNOWN";
  return route.source === "amap" ? "REAL" : "MOCK";
}

function placeLevel(provider: TravelDataProvider): ProviderLevel {
  return provider.kind === "amap" ? "REAL" : "MOCK";
}

function weatherLevel(provider: TravelDataProvider, missing: boolean): ProviderLevel {
  if (missing) return "UNKNOWN";
  return provider.kind === "amap" ? "REAL" : "MOCK";
}

function estimateRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }, mode: "walk" | "metro" | "bus" | "taxi" | "drive"): ProviderRoute {
  const distanceMeters = haversineMeters(origin, destination);
  const estimate = estimateTransit(distanceMeters);
  return {
    source: "mock",
    mode,
    distanceMeters,
    durationMinutes: estimate.minutes,
    polyline: [[origin.lng, origin.lat], [destination.lng, destination.lat]],
    steps: [{ instruction: "直线距离估算", distanceMeters, durationMinutes: estimate.minutes }],
  };
}

function routeSegment(input: {
  trip: Trip;
  dayId: string;
  from: ItineraryItem;
  to: ItineraryItem;
  fromPlace: Place;
  toPlace: Place;
  route: ProviderRoute;
  estimated: boolean;
}): RouteSegment {
  const { route } = input;
  return {
    id: crypto.randomUUID(),
    tripId: input.trip.id,
    dayId: input.dayId,
    fromItemId: input.from.id,
    toItemId: input.to.id,
    fromPlaceId: input.fromPlace.id,
    toPlaceId: input.toPlace.id,
    mode: route.mode,
    distanceMeters: route.distanceMeters,
    durationMinutes: route.durationMinutes,
    meters: route.distanceMeters,
    minutes: route.durationMinutes,
    label: input.estimated ? "估算路线" : "高德路线",
    polyline: route.polyline,
    steps: route.steps,
    provider: input.estimated ? "haversine" : route.source === "amap" ? "amap" : "mock",
    estimated: input.estimated,
    provenance: input.estimated ? { source: "haversine", estimated: true } : route.source === "amap" ? { source: "amap", estimated: false } : { source: "demo", estimated: true },
    updatedAt: new Date().toISOString(),
  };
}

/** Maps a list with at most `limit` workers in flight. Route planning jobs are
 * independent provider calls; AMap personal keys allow ~3 QPS, so 3 is the
 * throughput ceiling we are willing to use. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function enrichRoutes(
  trip: Trip,
  provider: TravelDataProvider,
  allowEstimate: boolean,
  onlyDayId?: string,
  preferredMode?: "walk" | "metro" | "bus" | "taxi" | "drive",
  /** Real routes measured earlier by the route matrix — reused instead of re-querying. */
  matrixRouteLookup?: (fromPlaceId: string, toPlaceId: string) => ProviderRoute | undefined,
) {
  let next = onlyDayId ? recomputeDay(trip, onlyDayId) : recomputeTrip(trip);
  const dayIds = onlyDayId ? [onlyDayId] : next.days.map((day) => day.id);
  let level: ProviderLevel = provider.kind === "amap" ? "REAL" : "MOCK";
  const warnings: string[] = [];

  // Collect every hop across the target days first, then plan them with a
  // small worker pool — the old per-day serial loop left most of the QPS
  // budget idle and stretched generation by seconds per day.
  type SegmentJob = { dayId: string; from: ItineraryItem; to: ItineraryItem; fromPlace: Place; toPlace: Place; mode: "walk" | "metro" | "bus" | "taxi" | "drive" };
  const jobs: SegmentJob[] = [];
  for (const dayId of dayIds) {
    const items = next.items.filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
    for (let index = 0; index < items.length - 1; index += 1) {
      const from = items[index];
      const to = items[index + 1];
      const fromPlace = next.places.find((place) => place.id === from.placeId);
      const toPlace = next.places.find((place) => place.id === to.placeId);
      if (!fromPlace || !toPlace) continue;
      const baseline = next.segments.find((segment) => segment.dayId === dayId && segment.fromItemId === from.id && segment.toItemId === to.id);
      const mode = baseline?.mode === "highspeed" || baseline?.mode === "flight"
        ? "taxi"
        : preferredMode ?? baseline?.mode ?? "walk";
      jobs.push({ dayId, from, to, fromPlace, toPlace, mode });
    }
  }
  const routed = await mapWithConcurrency(jobs, 3, async (job) => {
    try {
      // Brain route-matrix reuse: a route already measured by the matrix for
      // the same mode is consumed instead of spending another QPS slot.
      const measured = matrixRouteLookup?.(job.fromPlace.id, job.toPlace.id);
      const route = measured && measured.mode === job.mode
        ? measured
        : await provider.planRoute({ origin: job.fromPlace, destination: job.toPlace, mode: job.mode, city: next.destination });
      return { segment: routeSegment({ trip: next, dayId: job.dayId, from: job.from, to: job.to, fromPlace: job.fromPlace, toPlace: job.toPlace, route, estimated: provider.kind !== "amap" }), estimated: false };
    } catch (error) {
      if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
      const route = estimateRoute(job.fromPlace, job.toPlace, job.mode);
      return { segment: routeSegment({ trip: next, dayId: job.dayId, from: job.from, to: job.to, fromPlace: job.fromPlace, toPlace: job.toPlace, route, estimated: true }), estimated: true };
    }
  });
  const resolvedByDay = new Map<string, RouteSegment[]>();
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const { segment, estimated } = routed[index];
    const list = resolvedByDay.get(job.dayId) ?? [];
    list.push(segment);
    resolvedByDay.set(job.dayId, list);
    if (estimated) {
      level = "ESTIMATED";
      warnings.push(`Route ${job.fromPlace.name} → ${job.toPlace.name} uses Haversine estimation`);
    }
  }
  for (const dayId of dayIds) {
    next = { ...next, segments: [...next.segments.filter((segment) => segment.dayId !== dayId), ...resolvedByDay.get(dayId) ?? []] };
    next = recomputeDay(next, dayId);
  }
  return { trip: next, level, warnings };
}

function uniquePlaces(places: Place[]) {
  return [...new Map(places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng)).map((place) => [place.sourceId ?? place.id, place])).values()];
}

async function collectCandidates(provider: TravelDataProvider, destination: string) {
  const groups: Array<[string, Place["category"]]> = [
    ["景点", "attraction"], ["美食", "food"], ["咖啡", "cafe"], ["酒店", "hotel"], ["购物", "shopping"], ["展览 室内", "activity"],
  ];
  // AMap Web Service keys commonly have a ~3 QPS quota, and this call runs
  // concurrently with the weather request — so POI searches go in batches of
  // two with a short pause, plus exactly one spaced retry for transient QPS
  // rejections. Faster than the old strictly-serial + fixed-500ms loop,
  // without breaching the ceiling.
  const searchOne = async (query: string, category: Place["category"]): Promise<Place[]> => {
    const attempt = () => provider.searchPlaces({ destination, query, category, limit: 12 });
    try {
      return await attempt();
    } catch (error) {
      if (provider.kind !== "amap") throw error;
      await new Promise((resolve) => setTimeout(resolve, 700));
      return attempt();
    }
  };
  const batchSize = provider.kind === "amap" ? 2 : groups.length;
  const results: Place[][] = [];
  for (let index = 0; index < groups.length; index += batchSize) {
    if (provider.kind === "amap" && index > 0) await new Promise((resolve) => setTimeout(resolve, 400));
    results.push(...await Promise.all(groups.slice(index, index + batchSize).map(([query, category]) => searchOne(query, category))));
  }
  const candidates = uniquePlaces(results.flat());
  if (candidates.length < 4) throw new SkillError("NO_POI_RESULTS", `Only ${candidates.length} valid POIs were returned`);
  return candidates;
}

/** A place must trace back to real provider data — never an invented object. */
function placeProvenanceVerified(place: Place) {
  return place.provenance?.source === "amap" || place.provenance?.source === "demo"
    || ((place.source === "amap" || place.source === "demo") && Boolean(place.sourceId));
}

function itemType(place: Place): ItineraryItem["type"] {
  if (place.category === "food" || place.category === "cafe") return "food";
  if (place.category === "hotel") return "hotel";
  if (place.category === "activity") return "activity";
  if (place.category === "transport") return "transport";
  return "place";
}

function isIndoor(place?: Place) {
  if (!place) return false;
  return /室内|博物馆|美术馆|展览|商场|剧场|影院|文创/.test([place.name, place.description, ...place.tags].join(" "));
}

function isOutdoor(place?: Place) {
  if (!place) return false;
  return /户外|公园|山|江|桥|步道|古镇|广场|夜景/.test([place.name, place.description, ...place.tags].join(" ")) || place.category === "viewpoint";
}

function currentDayId(trip: Trip, asOf?: string) {
  const date = (asOf ? new Date(asOf) : new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  return trip.days.find((day) => day.date === date)?.id;
}

function lockedItemIds(trip: Trip) {
  return new Set(trip.items.filter((item) => item.status !== "planned").map((item) => item.id));
}

function transportContextFromInstruction(
  instruction: string,
  trip: Trip,
): Partial<TransportContext> | null {
  if (!/少走|走路|步行|交通|地铁|轨道|公交|打车|出租车|路线|换乘|行李|无障碍|很累|太累|疲劳/.test(instruction)) {
    return null;
  }
  return {
    travelers: trip.travelers,
    ...( /少走|走路|步行|很累|太累|疲劳/.test(instruction)
      ? { walkingTolerance: "low" as const, fatigue: "high" as const }
      : {}),
    ...( /行李/.test(instruction) ? { hasLuggage: true } : {}),
    ...( /无障碍|老人|轮椅/.test(instruction) ? { accessibilityNeeds: true } : {}),
    ...( /雨|下雨/.test(instruction) ? { weather: "rain" as const } : {}),
  };
}

function restoreLockedItems(original: Trip, proposed: Trip, locked: Set<string>) {
  const originals = new Map(original.items.filter((item) => locked.has(item.id)).map((item) => [item.id, item]));
  return { ...proposed, items: proposed.items.map((item) => originals.get(item.id) ?? item) };
}

function socialRouter(): SocialProviderRouter {
  // TikHub is the only social provider: its endpoints return posts that can be
  // verified into SocialObservations. (RedFox was removed — its documented
  // endpoint returned douyin account profiles, which can never produce a post.)
  return new SocialProviderRouter([createTikHubProvider()]);
}

const DEFAULT_SOCIAL_PLATFORMS: SocialPlatform[] = ["douyin", "xiaohongshu", "weibo", "wechat_search"];

interface SocialCollectResult {
  observations: SocialObservation[];
  platformStatus: Record<string, SocialProviderStatus>;
  warnings: string[];
}

/**
 * When the caller names a platform, hit it directly; otherwise fan out across
 * the Chinese-content platforms — TikHub's own default is international TikTok,
 * which carries almost no domestic travel content.
 */
async function collectSocialObservations(
  router: SocialProviderRouter,
  input: { city: string; query?: string; platform?: string; limit: number; operation?: "searchContent" | "getTrending" },
): Promise<SocialCollectResult> {
  const operation = input.operation ?? "searchContent";
  const platform = input.platform as SocialPlatform | undefined;
  if (platform) {
    const result = await router[operation]({ city: input.city, query: input.query, platform, limit: input.limit });
    return { observations: result.data, platformStatus: { [platform]: result.status }, warnings: result.warnings };
  }
  const settled = await Promise.all(DEFAULT_SOCIAL_PLATFORMS.map(async (p) => {
    try {
      const result = await router[operation]({ city: input.city, query: input.query, platform: p, limit: Math.min(input.limit, 5) });
      return { platform: p, result };
    } catch (error) {
      logger.warn("social.collect_failed", { platform: p, operation, error });
      return { platform: p, result: { status: "error" as const, data: [] as SocialObservation[], warnings: ["request failed"] } };
    }
  }));
  const seen = new Set<string>();
  const observations: SocialObservation[] = [];
  for (const { result } of settled) {
    for (const observation of result.data) {
      const dedupeKey = `${observation.provider}|${observation.platform}|${observation.sourceId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      observations.push(observation);
    }
  }
  const platformStatus = Object.fromEntries(settled.map(({ platform, result }) => [
    platform, result.status === "ok" && result.data.length === 0 ? "unavailable" : result.status,
  ]));
  const warnings = settled.flatMap(({ platform, result }) => result.warnings.map((warning) => `${platform}: ${warning}`));
  return { observations, platformStatus, warnings };
}

function socialLevelFromStatuses(statuses: Record<string, string>, observationCount: number): ProviderLevel {
  const values = Object.values(statuses);
  if (values.includes("ok")) return observationCount > 0 ? "SOCIAL" : "UNKNOWN";
  if (values.includes("error")) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

function socialQueryStatus(input: {
  requested: boolean;
  statuses: Record<string, SocialProviderStatus>;
  evidenceCount: number;
  usedByPlanner: boolean;
}): NonNullable<Trip["socialQueryStatus"]> {
  if (!input.requested) return "not_requested";
  if (input.usedByPlanner && input.evidenceCount > 0) return "used";
  if (input.evidenceCount > 0 || Object.values(input.statuses).includes("ok")) return "queried_not_used";
  if (Object.values(input.statuses).includes("error")) return "error";
  return "unavailable";
}

function socialEngagement(observation: SocialObservation): number {
  const { likes = 0, comments = 0, shares = 0 } = observation.metrics;
  return likes + comments + shares;
}

function recentRelevantObservations(input: { city: string; poi?: string }, observations: SocialObservation[]): SocialObservation[] {
  return observations
    .filter((item) => item.content.includes(input.city) || (input.poi && item.content.includes(input.poi)))
    .filter((item) => !item.publishedAt || Number.isFinite(Date.parse(item.publishedAt)) && Date.now() - Date.parse(item.publishedAt) < 30 * 86_400_000)
    .slice(0, 20);
}

type PoiMatch = { placeId: string; name: string; confidence: number; matchBasis: "entity_id" | "name_contains" | "unknown" };

/** First-generation POI alignment: entity id when the provider reports one, otherwise name containment. Unmatched evidence stays UNKNOWN. */
function alignObservationToPois(observation: SocialObservation, poi: string | undefined, places: Array<{ id: string; name: string }> | undefined): PoiMatch[] {
  if (!places?.length) return [];
  const haystack = `${observation.content} ${observation.summary ?? ""}`.toLowerCase();
  const matches: PoiMatch[] = [];
  for (const place of places) {
    const name = place.name.trim();
    if (name.length < 2) continue;
    if (observation.entityId && observation.entityId === place.id) {
      matches.push({ placeId: place.id, name, confidence: 0.8, matchBasis: "entity_id" });
    } else if (haystack.includes(name.toLowerCase())) {
      matches.push({ placeId: place.id, name, confidence: 0.5, matchBasis: "name_contains" });
    } else if (poi && name.includes(poi) && haystack.includes(poi.toLowerCase())) {
      matches.push({ placeId: place.id, name, confidence: 0.4, matchBasis: "name_contains" });
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function buildSocialEvidence(input: { city: string; poi?: string; observations: SocialObservation[]; places?: Array<{ id: string; name: string }> }): { evidence: SocialEvidence[]; signals: ReturnType<typeof extractSocialSignals> } {
  const signals = extractSocialSignals(input.observations);
  const evidence = input.observations.map((observation) => {
    const related = signals.filter((signal) => signal.sources.some((source) => source.sourceId === observation.sourceId && source.platform === observation.platform));
    const link = resolveSourceLink({
      platform: observation.platform,
      sourceId: observation.sourceId,
      upstreamUrl: observation.sourceUrl,
    });
    return {
      provider: observation.provider,
      platform: observation.platform,
      sourceId: observation.sourceId,
      ...(link ? { sourceUrl: link.url, sourceUrlKind: link.kind } : {}),
      summary: observation.summary ?? observation.content.slice(0, 180),
      city: observation.city,
      publishedAt: observation.publishedAt,
      fetchedAt: observation.fetchedAt,
      expiresAt: observation.expiresAt,
      signalTypes: related.map((signal) => signal.signalType),
      confidence: related.length ? Math.max(...related.map((signal) => signal.confidence)) : 0.25,
      sampleSize: related.length ? Math.max(...related.map((signal) => signal.sampleSize)) : 1,
      metrics: observation.metrics,
      poiMatches: alignObservationToPois(observation, input.poi, input.places),
      warnings: ["社交平台内容仅作攻略参考，不替代实时供应商事实"],
    } satisfies SocialEvidence;
  });
  return { evidence, signals };
}

function socialQueryId(input: { city: string; poi?: string; query?: string }): string {
  return createHash("sha256").update(`${input.city}|${input.poi ?? ""}|${input.query ?? ""}`).digest("hex").slice(0, 32);
}

export class VoyageSkillRuntime {
  constructor(
    private readonly repository: JsonSkillRepository,
    private readonly providerFactory: () => Promise<TravelDataProvider> = providerFromEnvironment,
    private readonly socialRouterFactory: () => SocialProviderRouter = socialRouter,
  ) {}

  async createTrip(raw: unknown) {
    const input = createTripInputSchema.parse(raw);
    const provider = await this.providerFactory();
    const finish = input.endDate ?? endDate(input.startDate, input.days ?? 1);
    const profile = input.planningProfile;
    // One truth for the trip length: every prompt, filter and validation below
    // must agree, so the profile is normalised before anything reads it.
    const alignedProfile = profile ? alignPlanningDays(profile) : undefined;
    const planningPrompt = alignedProfile
      ? [input.prompt, planningProfileToPrompt(alignedProfile)].filter(Boolean).join("\n")
      : input.prompt;
    const effectiveTravelers = alignedProfile?.travelers ?? input.travelers ?? input.people;
    const effectiveBudget = alignedProfile?.budget ?? input.budget;
    const effectiveVibes = alignedProfile?.vibes.length ? alignedProfile.vibes : input.vibes ?? input.preferences;
    const includeSocial = input.includeSocialEvidence || Boolean(alignedProfile?.socialOptIn || alignedProfile?.includeSocialEvidence);
    const includeOffers = input.includeExternalOffers || Boolean(alignedProfile?.includeExternalOffers);
    // POI search, weather and social observation are mutually independent:
    // running them concurrently instead of back-to-back trims seconds off
    // every generation before the (unavoidably serial) LLM outline call.
    const [providerCandidates, forecasts, social] = await Promise.all([
      collectCandidates(provider, input.destination).catch((error) => {
        throw normalizeProviderError(error, "NO_POI_RESULTS");
      }),
      provider.getWeather(input.destination).catch((error) => {
        if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
        return [];
      }),
      includeSocial
        ? collectSocialObservations(this.socialRouterFactory(), {
            city: input.destination,
            query: planningPrompt,
            limit: 5,
          }).catch((error) => ({
            observations: [] as SocialObservation[],
            platformStatus: Object.fromEntries(DEFAULT_SOCIAL_PLATFORMS.map((platform) => [platform, "error" as const])) as Record<string, SocialProviderStatus>,
            warnings: [error instanceof Error ? error.message : "social search failed"],
          }))
        : undefined,
    ]);
    const candidates = alignedProfile
      ? filterPlanningCandidates(providerCandidates, alignedProfile, daysBetween(input.startDate, finish))
      : providerCandidates;
    const constraintWarnings = planningConstraintWarnings(alignedProfile, providerCandidates, candidates);
    if (!candidates.length) {
      throw new SkillError("NO_POI_RESULTS", "旅行画像过滤后没有可用的 provider 候选", { warnings: constraintWarnings });
    }
    const socialBuilt = social
      ? buildSocialEvidence({ city: input.destination, observations: social.observations, places: candidates })
      : { evidence: [], signals: [] };

    // Travel Brain (Phase 4.1): build the partial route matrix BEFORE the LLM
    // orders stops, so the planner sees real A→B time instead of guessing.
    // Off unless VOYAGE_BRAIN=1; any brain failure must never break trip creation.
    const brainEnabled = process.env.VOYAGE_BRAIN === "1";
    const count = daysBetween(input.startDate, finish);
    const tripDates = Array.from({ length: count }, (_, index) => endDate(input.startDate, index + 1));
    const brainTravelers = effectiveTravelers ?? input.people;
    let matrix: RouteMatrix | undefined;
    let matrixRoutes: Map<string, ProviderRoute> | undefined;
    let candidateIntel: Record<string, string> | undefined;
    let routeSummary: string | undefined;
    if (brainEnabled) {
      try {
        const matrixMode = preferredRouteMode(alignedProfile) ?? "walk";
        const matrixPlaces = candidates.slice(0, 24);
        const built = await buildRouteMatrix({
          city: input.destination,
          places: matrixPlaces,
          provider,
          mode: matrixMode,
          priorityPlaceIds: matrixPlaces
            .filter((place) => (alignedProfile?.mustVisit ?? []).some((term) => brainPlaceMatchesTerm(place, term)))
            .map((place) => place.id),
          maxRealEdges: 8,
          travelers: brainTravelers,
        });
        matrix = built.matrix;
        matrixRoutes = built.realRoutes;
        candidateIntel = routeIntelByPlace(matrixPlaces, matrix);
        routeSummary = summarizeRouteMatrix(matrixPlaces, matrix);
      } catch (error) {
        logger.warn("brain.route_matrix_failed", { error });
        routeSummary = undefined;
      }
    }
    const weatherSummary = forecasts.length
      ? tripDates
          .map((date) => {
            const weather = weatherForDate(forecasts, date);
            return `${date} ${weather.condition} ${weather.tempC}°C${weather.condition.includes("雨") ? " [有雨]" : ""}`;
          })
          .join("；")
      : undefined;

    const planResult = await planOutline({
      prompt: planningPrompt,
      destination: input.destination,
      startDate: input.startDate,
      endDate: finish,
      travelers: effectiveTravelers,
      budget: effectiveBudget,
      vibes: effectiveVibes,
      candidates,
      ...(socialBuilt.signals.length ? { social: { signals: socialBuilt.signals } } : {}),
      ...(candidateIntel ? { candidateIntel } : {}),
      ...(routeSummary ? { routeSummary } : {}),
      ...(weatherSummary ? { weatherSummary } : {}),
    });

    // Constraint gate: check the outline against the traveller's stated hard
    // constraints, repair once deterministically, and keep whatever still
    // violates as warnings. The LLM's choice is never silently trusted.
    let outline = planResult.outline;
    let brainMeta: BrainMetadata | undefined;
    const brainWarnings: string[] = [];
    if (brainEnabled) {
      try {
        const brainContext = {
          candidates,
          ...(alignedProfile ? { profile: alignedProfile } : {}),
          ...(matrix ? { matrix } : {}),
          expectedDays: count,
          budget: effectiveBudget,
          travelers: brainTravelers,
        };
        let evaluation = evaluateOutline(outline, brainContext);
        let repairs: string[] = [];
        if (evaluation.hardViolations.length) {
          const repaired = repairOutline(outline, evaluation, brainContext);
          outline = repaired.outline;
          repairs = repaired.applied;
          evaluation = evaluateOutline(outline, brainContext);
        }
        // The unmatched-must-visit data gap is already reported by
        // planningConstraintWarnings below; don't say it twice.
        brainWarnings.push(...evaluation.warnings.filter((warning) => !(warning.startsWith("必去「") && warning.includes("在候选地点中无匹配"))));
        brainWarnings.push(...repairs.map((fix) => `Travel Brain 修复：${fix}`));
        brainMeta = {
          version: "4.1",
          routeMatrix: {
            realEdges: matrix?.edges.filter((edge) => edge.queried).length ?? 0,
            estimatedEdges: (matrix?.edges.length ?? 0) - (matrix?.edges.filter((edge) => edge.queried).length ?? 0),
            coverage: matrix?.coverage ?? 0,
          },
          constraintEvaluation: evaluation,
          repairs,
        };
      } catch (error) {
        logger.warn("brain.constraint_gate_failed", { error });
      }
    }

    const socialStatus = socialQueryStatus({
      requested: includeSocial,
      statuses: social?.platformStatus ?? {},
      evidenceCount: socialBuilt.evidence.length,
      usedByPlanner: planResult.source === "llm" && socialBuilt.signals.length > 0,
    });

    const tripId = createTripId();
    const days: Day[] = Array.from({ length: count }, (_, index) => {
      const date = endDate(input.startDate, index + 1);
      return {
        id: `${tripId}-day-${index + 1}`,
        tripId,
        index,
        date,
        title: outline.dayPlans[index]?.title ?? `Day ${index + 1}`,
        summary: outline.dayPlans[index]?.summary ?? "",
        weather: weatherForDate(forecasts, date),
      };
    });
    const items: ItineraryItem[] = [];
    outline.dayPlans.forEach((dayPlan, dayIndex) => dayPlan.stops.forEach((stop, order) => {
      const place = candidates.find((candidate) => candidate.id === stop.placeId);
      if (!place || !days[dayIndex]) return;
      items.push({
        id: crypto.randomUUID(), dayId: days[dayIndex].id, type: itemType(place), placeId: place.id,
        startTime: stop.startTime, duration: stop.durationMinutes, order, status: "planned", ...(stop.meal ? { meal: stop.meal } : {}),
      });
    }));
    let trip: Trip = {
      id: tripId, title: planResult.outline.title, destination: input.destination, origin: alignedProfile?.origin ?? input.origin, startDate: input.startDate, endDate: finish,
      travelers: effectiveTravelers, budget: effectiveBudget, currency: "CNY", status: "ready",
      estimatedSpend: Math.round(effectiveBudget * 0.85), coverImage: "", vibe: effectiveVibes,
      prompt: planningPrompt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), days, items,
      segments: [], places: candidates, hotels: [], restaurants: [], activities: [], transports: [], tasks: [], budgetItems: [],
      planningMetadata: {
        source: planResult.source,
        llm: planResult.llm,
        ...(planResult.fallbackReason ? { fallbackReason: planResult.fallbackReason } : {}),
        ...(input.planningSessionId ? { planningSessionId: input.planningSessionId } : {}),
        ...(alignedProfile ? { planningProfile: alignedProfile } : {}),
        ...(brainMeta ? { brain: brainMeta } : {}),
        social: socialStatus,
      },
      socialQueryStatus: socialStatus,
      ...(social
        ? {
            socialQueryId: socialQueryId({ city: input.destination, query: planningPrompt }),
            socialPlatformStatus: social.platformStatus,
            socialEvidence: socialBuilt.evidence,
            socialSignals: socialBuilt.signals,
            socialWarnings: social.warnings,
          }
        : {}),
    };
    trip = estimateBudgetItems(trip);
    const routePromise = enrichRoutes(
      trip,
      provider,
      input.fallbackPolicy === "estimated",
      undefined,
      preferredRouteMode(alignedProfile),
      matrixRoutes ? (fromPlaceId: string, toPlaceId: string) => findRealMatrixRoute(matrixRoutes, fromPlaceId, toPlaceId) : undefined,
    );
    const offerPromise = includeOffers
      ? queryMeituan({
          origin: alignedProfile?.origin ?? input.origin,
          destination: input.destination,
          startDate: input.startDate,
          endDate: finish,
          travelers: effectiveTravelers,
          budget: effectiveBudget,
          query: planningPrompt || `推荐${input.destination}的交通、酒店、景点门票、美食和优惠`,
          city: input.destination,
          categories: input.offerCategories,
        }).then((result) => ({ result })).catch((error: unknown) => ({ error }))
      : Promise.resolve({ result: null as Awaited<ReturnType<typeof queryMeituan>> | null });
    const coverPromise = resolveCityCoverImage(input.destination, candidates);
    const [routed, offerOutcome, coverImage] = await Promise.all([routePromise, offerPromise, coverPromise]);
    let finalTrip = routed.trip;
    if (coverImage) finalTrip = { ...finalTrip, coverImage };
    let offerLevel: ProviderLevel = "UNKNOWN";
    const offerWarnings: string[] = [];
    if (includeOffers) {
      if ("result" in offerOutcome && offerOutcome.result) {
        const offerResult = offerOutcome.result;
        finalTrip = { ...finalTrip, offers: offerResult.offers, offerProviderStatus: offerResult.status };
        offerLevel = offerResult.status.overall;
        offerWarnings.push(...(offerResult.status.warnings ?? []));
      } else {
        const error = "error" in offerOutcome ? offerOutcome.error : undefined;
        const message = error instanceof SkillError ? error.message : error instanceof Error ? error.message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]") : "Meituan offers are unavailable";
        finalTrip = { ...finalTrip, offers: [], offerProviderStatus: { overall: "UNAVAILABLE", warnings: [message] } };
        offerLevel = "UNAVAILABLE";
        offerWarnings.push(message);
      }
    }
    const stored = await this.repository.createTrip(finalTrip);
    const missingWeather = days.some((day) => day.weather.provenance?.source === "unavailable");
    const socialLevel = includeSocial
      ? socialLevelFromStatuses(social?.platformStatus ?? {}, socialBuilt.evidence.length)
      : undefined;
    const providerStatus = status(
      placeLevel(provider),
      routed.level,
      weatherLevel(provider, missingWeather),
      includeOffers ? offerLevel : undefined,
      socialLevel,
    );
    return successEnvelope(
      { tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash },
      providerStatus,
      [...constraintWarnings, ...routed.warnings, ...brainWarnings, ...(social?.warnings ?? []), ...(planResult.fallbackReason ? [planResult.fallbackReason] : []), ...offerWarnings],
    );
  }

  async getTrip(raw: unknown) {
    const { tripId } = getTripInputSchema.parse(raw);
    const stored = await this.repository.getTrip(tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    return successEnvelope({ tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
  }

  async searchPlaces(raw: unknown) {
    const input = searchPlacesInputSchema.parse(raw);
    const provider = await this.providerFactory();
    const places = uniquePlaces(await provider.searchPlaces(input).catch((error) => {
      throw normalizeProviderError(error, "NO_POI_RESULTS");
    }));
    if (!places.length) throw new SkillError("NO_POI_RESULTS", "No matching places found");
    return successEnvelope({ places }, status(placeLevel(provider), "UNKNOWN", "UNKNOWN"));
  }

  async planRoute(raw: unknown) {
    const input = planRouteInputSchema.parse(raw);
    const provider = await this.providerFactory();
    try {
      const route = await provider.planRoute(input);
      return successEnvelope({ route: { ...route, estimated: provider.kind !== "amap" } }, status("UNKNOWN", routeLevel(route), "UNKNOWN"));
    } catch (error) {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
      const route = estimateRoute(input.origin, input.destination, input.mode);
      return successEnvelope({ route: { ...route, source: "haversine", estimated: true } }, status("UNKNOWN", "ESTIMATED", "UNKNOWN"), ["Route uses Haversine estimation"]);
    }
  }

  async getRouteOptions(raw: unknown) {
    const input = getRouteOptionsInputSchema.parse(raw);
    const allowEstimate = input.fallbackPolicy === "estimated";
    let provider: TravelDataProvider | undefined;
    try {
      provider = await this.providerFactory();
    } catch (error) {
      if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
    }
    const routeOptions = await buildRouteOptionSet({
      provider,
      origin: input.origin,
      destination: input.destination,
      city: input.city,
      modes: input.modes,
      context: input.context,
      allowEstimate,
    }).catch((error) => {
      throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
    });
    const routeStatus: ProviderLevel = routeOptions.options.some((option) => option.estimated)
      ? "ESTIMATED"
      : provider?.kind === "amap" ? "REAL" : "MOCK";
    return successEnvelope(
      { routeOptions },
      status("UNKNOWN", routeStatus, "UNKNOWN"),
      routeOptions.warnings,
    );
  }

  async optimizeTransport(raw: unknown) {
    const input = optimizeTransportInputSchema.parse(raw);
    const planningContext = await buildTransportKnowledgeContext({
      city: input.city,
      context: input.context,
      userQuery: "城市地形 市内交通 步行 换乘 天气 疲劳 行李",
      limit: 8,
    });
    const envelope = await this.getRouteOptions({
      ...input,
      context: planningContext.effectiveTransportContext,
    }) as {
      data: { routeOptions: Awaited<ReturnType<typeof buildRouteOptionSet>> };
      warnings: string[];
      providerStatus: ProviderStatus;
    };
    const routeOptions = envelope.data.routeOptions;
    return successEnvelope(
      {
        recommended: routeOptions.options[0],
        alternatives: routeOptions.options.slice(1),
        routeOptions,
        knowledge: planningContext.evidence,
        knowledgeRetrieval: planningContext.retrieval,
        knowledgeCitations: planningContext.citations,
        knowledgeRationale: planningContext.rationale,
      },
      envelope.providerStatus,
      [...envelope.warnings, ...planningContext.retrieval.warnings],
    );
  }

  async retrieveTravelKnowledge(raw: unknown) {
    const input = retrieveTravelKnowledgeInputSchema.parse(raw);
    const retrieval = await retrieveTravelKnowledgeHybrid(input);
    return successEnvelope({
      city: input.city,
      query: input.query,
      matches: retrieval.matches,
      retrieval: {
        strategy: retrieval.strategy,
        vectorUsed: retrieval.vectorUsed,
        databaseUsed: retrieval.databaseUsed,
        note: "RAG knowledge supplements live providers; realtime route, weather, availability and price facts stay authoritative.",
      },
    }, status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, undefined, retrieval.matches.length ? "CURATED" : "UNKNOWN"), retrieval.warnings);
  }

  async replanTrip(raw: unknown) {
    const input = replanTripInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    const allowEstimate = input.fallbackPolicy === "estimated";
    let provider: TravelDataProvider | undefined;
    try {
      provider = await this.providerFactory();
    } catch (error) {
      if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
    }

    const original = stored.trip;
    const targetDays = input.dayId
      ? original.days.filter((day) => day.id === input.dayId)
      : original.days;
    if (!targetDays.length) throw new SkillError("INVALID_INPUT", "Target day not found");

    const actions: TravelAction[] = [];
    const routePlans: Array<{
      dayId: string;
      segmentId: string;
      fromPlace: string;
      toPlace: string;
      previousMode: string;
      recommendedMode: string;
      score: number;
      recommended: ScoredTransportOption;
      alternatives: ScoredTransportOption[];
    }> = [];
    const warnings: string[] = [];
    const knowledgeById = new Map<string, Awaited<ReturnType<typeof buildTransportKnowledgeContext>>["evidence"][number]>();
    const knowledgeRetrievals: Array<{
      dayId: string;
      strategy: string;
      vectorUsed: boolean;
      databaseUsed: boolean;
      query: string;
      citations: Awaited<ReturnType<typeof buildTransportKnowledgeContext>>["citations"];
    }> = [];

    for (const day of targetDays) {
      const baseDayContext: Partial<TransportContext> = {
        ...input.context,
        travelers: input.context.travelers ?? original.travelers,
        weather: input.context.weather ??
          (day.weather.icon === "rain" || day.weather.condition.includes("雨") ? "rain" : "unknown"),
      };
      const planningContext = await buildTransportKnowledgeContext({
        city: original.destination,
        context: baseDayContext,
        userQuery: [day.title, day.summary, input.instruction, "市内交通 路线优化"].filter(Boolean).join(" "),
        limit: 8,
      });
      planningContext.evidence.forEach((match) => knowledgeById.set(match.id, match));
      knowledgeRetrievals.push({
        dayId: day.id,
        strategy: planningContext.retrieval.strategy,
        vectorUsed: planningContext.retrieval.vectorUsed,
        databaseUsed: planningContext.retrieval.databaseUsed,
        query: planningContext.query,
        citations: planningContext.citations,
      });
      warnings.push(...planningContext.retrieval.warnings.map((warning) => `Knowledge: ${warning}`));
      const dayContext: Partial<TransportContext> = {
        ...baseDayContext,
        ...planningContext.effectiveTransportContext,
      };
      const segments = original.segments.filter((segment) => segment.dayId === day.id);
      for (const segment of segments) {
        const fromPlace = original.places.find((place) => place.id === segment.fromPlaceId);
        const toPlace = original.places.find((place) => place.id === segment.toPlaceId);
        if (!fromPlace || !toPlace) continue;
        const optionSet = await buildRouteOptionSet({
          provider,
          origin: { lat: fromPlace.lat, lng: fromPlace.lng },
          destination: { lat: toPlace.lat, lng: toPlace.lng },
          city: original.destination,
          context: dayContext,
          allowEstimate,
        }).catch((error) => {
          throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
        });
        warnings.push(...optionSet.warnings);
        const recommended = optionSet.options[0];
        routePlans.push({
          dayId: day.id,
          segmentId: segment.id,
          fromPlace: fromPlace.name,
          toPlace: toPlace.name,
          previousMode: segment.mode,
          recommendedMode: recommended.mode,
          score: recommended.score,
          recommended,
          alternatives: optionSet.options.slice(1, 4),
        });
        if (recommended.mode !== segment.mode) {
          actions.push({
            type: "CHANGE_ROUTE_MODE",
            payload: { segmentId: segment.id, dayId: day.id, newMode: recommended.mode },
          });
        }
      }
    }

    const knowledge = [...knowledgeById.values()];

    if (!actions.length) {
      return successEnvelope({
        tripId: original.id,
        proposalId: null,
        routePlans,
        knowledge,
        knowledgeRetrievals,
        summary: "当前市内交通方式已符合综合评分，无需修改。",
      }, status("UNKNOWN", provider?.kind === "amap" ? "REAL" : "ESTIMATED", "UNKNOWN"), warnings);
    }

    const execution = executeActions(original, actions);
    let proposed = execution.trip;
    let routeStatus: ProviderLevel = provider?.kind === "amap" ? "REAL" : "ESTIMATED";
    if (provider) {
      for (const day of targetDays) {
        const routed = await enrichRoutes(proposed, provider, allowEstimate, day.id);
        proposed = routed.trip;
        routeStatus = routed.level;
        warnings.push(...routed.warnings);
      }
    } else {
      const planBySegment = new Map(routePlans.map((plan) => [plan.segmentId, plan.recommended]));
      proposed = {
        ...proposed,
        segments: proposed.segments.map((segment) => {
          const recommended = planBySegment.get(segment.id);
          if (!recommended) return segment;
          return {
            ...segment,
            mode: recommended.mode,
            distanceMeters: recommended.distanceMeters,
            durationMinutes: recommended.durationMinutes,
            meters: recommended.distanceMeters,
            minutes: recommended.durationMinutes,
            label: recommended.mode,
            polyline: recommended.polyline,
            steps: recommended.steps,
            provider: recommended.source === "amap" ? "amap" : recommended.source === "mock" ? "mock" : "haversine",
            estimated: recommended.estimated,
            estimatedCost: Math.round((recommended.cost.min + recommended.cost.max) / 2),
            provenance: recommended.estimated
              ? { source: "haversine" as const, estimated: true as const }
              : { source: "amap" as const, estimated: false as const },
            updatedAt: recommended.updatedAt,
          };
        }),
      };
    }

    const summary = "已按时间、费用、步行、换乘、天气、疲劳与数据可靠性重新评估市内交通。";
    const changeSet = computeTripChangeSet(original, proposed, execution.applied, summary);
    const { record: proposal, token } = await this.repository.saveProposal({
      tripId: original.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions: execution.applied,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope({
      proposalId: proposal.id,
      proposalToken: token,
      tripId: original.id,
      baseRevision: proposal.baseRevision,
      actions: proposal.actions,
      changes: proposal.changeSet,
      routePlans,
      knowledge,
      knowledgeRetrievals,
      summary,
    }, status("UNKNOWN", routeStatus, "UNKNOWN"), warnings);
  }

  async getWeather(raw: unknown) {
    const input = getWeatherInputSchema.parse(raw);
    let provider: TravelDataProvider | undefined;
    try {
      provider = await this.providerFactory();
    } catch (error) {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
    }
    let forecasts: ProviderForecast[] = [];
    if (provider) {
      try {
        forecasts = await provider.getWeather(input.destination);
      } catch (error) {
        if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
      }
    }
    const weather = input.dates.map((date) => ({ date, ...weatherForDate(forecasts, date) }));
    const missing = weather.some((item) => item.provenance.source === "unavailable");
    const level: ProviderLevel = provider ? weatherLevel(provider, missing) : "UNAVAILABLE";
    return successEnvelope({ weather }, status("UNKNOWN", "UNKNOWN", level), missing ? ["Weather unavailable for one or more dates"] : []);
  }

  async searchFlights(raw: unknown) {
    const input = searchFlightsInputSchema.parse(raw);
    const client = createFliggyTopClient();
    if (!client) throw new SkillError("NO_PROVIDER_CONFIGURED", "FLIGGY_APP_KEY and FLIGGY_APP_SECRET are required");

    try {
      const data = await client.flightSearch(input);
      return successEnvelope(
        { flights: data, provenance: { source: "fliggy", estimated: false } },
        status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      );
    } catch (error) {
      throw normalizeProviderError(error, "TICKET_PROVIDER_UNAVAILABLE");
    }
  }

  async searchTravelOffers(raw: unknown) {
    const input = searchTravelOffersInputSchema.parse(raw);
    const result = await queryMeituan(input);
    return successEnvelope(
      { offers: result.offers, rawText: result.rawText, rawJson: result.rawJson },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN", result.status.overall),
      result.status.warnings,
    );
  }

  async refreshTravelOffers(raw: unknown) {
    const input = refreshTravelOffersInputSchema.parse(raw);
    const categories = input.categories;
    const provider = await this.providerFactory();
    const existing = await this.repository.getTrip(input.tripId);
    if (!existing) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    const dates = existing.trip.days.map((day) => day.date);
    const [meituanResult, fliggyResult, weatherResult] = await Promise.all([
      queryMeituan(input).catch((error) => ({ offers: [] as TravelOffer[], rawText: undefined, rawJson: undefined, status: { overall: "UNAVAILABLE" as const, warnings: [error instanceof SkillError ? error.message : "美团查询失败"] } })),
      queryFliggyOffers({ ...input, categories }).catch((error) => ({ offers: [] as TravelOffer[], status: "UNAVAILABLE" as OfferProviderLevel, warnings: [error instanceof Error ? error.message : "飞猪查询失败"] })),
      dates.length ? provider.getWeather(input.destination).then((forecasts) => ({ forecasts, level: forecasts.length ? "REAL" as const : "UNKNOWN" as const, warnings: [] as string[] })).catch(() => ({ forecasts: [], level: "UNAVAILABLE" as const, warnings: ["天气查询失败"] })) : Promise.resolve({ forecasts: [], level: "UNKNOWN" as const, warnings: ["未提供天气日期"] }),
    ]);
    const offers = [...meituanResult.offers, ...fliggyResult.offers];
    const categoryStatus = (kind: OfferKind): OfferProviderLevel => {
      if (offers.some((offer) => offer.kind === kind && offer.structured)) return "REAL";
      if (offers.some((offer) => offer.kind === kind)) return "UNSTRUCTURED";
      if (kind === "hotel" || kind === "flight") {
        if (fliggyResult.status === "PERMISSION_REQUIRED") return "PERMISSION_REQUIRED";
        return fliggyResult.status === "UNAVAILABLE" && meituanResult.status.overall === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN";
      }
      if (categories.includes(kind)) return meituanResult.status.overall;
      return "UNKNOWN";
    };
    const statusByKind: OfferProviderStatus = {
      overall: offers.some((offer) => offer.structured) ? "REAL" : offers.length || meituanResult.status.overall === "UNSTRUCTURED" ? "UNSTRUCTURED" : "UNAVAILABLE",
      hotel: categoryStatus("hotel"), train: categoryStatus("train"), flight: categoryStatus("flight"), ticket: categoryStatus("ticket"), restaurant: categoryStatus("restaurant"), coupon: categoryStatus("coupon"), weather: weatherResult.level,
      fetchedAt: new Date().toISOString(), warnings: [...(meituanResult.status.warnings ?? []), ...fliggyResult.warnings, ...weatherResult.warnings],
    };
    const stored = await this.repository.replaceOffers({
      tripId: input.tripId,
      expectedRevision: input.expectedTripRevision,
      offers,
      status: statusByKind,
      weatherByDate: input.destination === existing.trip.destination ? Object.fromEntries(dates.map((date) => [date, weatherForDate(weatherResult.forecasts, date)])) : undefined,
    });
    return successEnvelope(
      { tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash },
      status(provider.kind === "amap" ? "REAL" : "MOCK", "UNKNOWN", weatherResult.level, statusByKind.overall),
      statusByKind.warnings ?? [],
    );
  }

  async reorderDay(raw: unknown) {
    const input = reorderDayInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    if (!stored.trip.days.some((day) => day.id === input.dayId)) {
      // Without this a bad dayId "succeeds" with zero items reordered while
      // still bumping the revision for every concurrent editor.
      throw new SkillError("INVALID_INPUT", "目标日期不存在");
    }
    const rank = new Map(input.orderedItemIds.map((id, index) => [id, index]));
    const trip = recomputeDay({ ...stored.trip, items: stored.trip.items.map((item) => item.dayId === input.dayId && rank.has(item.id) ? { ...item, order: rank.get(item.id)! } : item) }, input.dayId);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async addPlaceItem(raw: unknown) {
    const input = addPlaceItemInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    if (!stored.trip.days.some((day) => day.id === input.dayId)) {
      throw new SkillError("INVALID_INPUT", "目标日期不存在");
    }
    const place = input.place;
    // Provenance guard: the place must be traceable to real provider data. A
    // hand-built or LLM-invented object can never enter a trip through here.
    if (!placeProvenanceVerified(place)) {
      throw new SkillError("PLACE_SOURCE_UNVERIFIED", "该地点缺少可核实的真实数据来源，不能加入行程");
    }
    let trip = structuredClone(stored.trip);
    if (!trip.items.some((item) => item.dayId === input.dayId && item.placeId === place.id)) {
      if (!trip.places.some((existing) => existing.id === place.id)) trip.places.push(place);
      const order = trip.items.filter((item) => item.dayId === input.dayId).length;
      trip.items.push({
        id: crypto.randomUUID(),
        dayId: input.dayId,
        type: itemType(place),
        placeId: place.id,
        startTime: "10:00",
        duration: place.stayMinutes || 60,
        order,
        status: "planned",
      });
      trip = recomputeDay(trip, input.dayId);
    } else {
      // Idempotent hit: report the stored trip as-is. Writing would bump the
      // revision for no change and trigger spurious conflicts elsewhere.
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * Bookmarks a provenance-verified place onto the trip without scheduling
   * it into any day — the persistence behind the map-mark buttons.
   */
  /**
   * Restores a full trip snapshot (undo/redo). User-initiated only, never
   * LLM-driven, revision-locked like every other write, and the trip id is
   * pinned to the input so a snapshot cannot be written under another record.
   */
  async restoreTrip(raw: unknown) {
    const input = restoreTripInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    // The snapshot already round-tripped through tripSchema; the cast matches
    // the repository's own validated-trip typing (segments arrive narrower).
    const trip = { ...(input.trip as Trip), id: input.tripId, updatedAt: new Date().toISOString() };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async addPlace(raw: unknown) {
    const input = addPlaceInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const place = input.place;
    if (!placeProvenanceVerified(place)) {
      throw new SkillError("PLACE_SOURCE_UNVERIFIED", "该地点缺少可核实的真实数据来源，不能加入地图");
    }
    if (stored.trip.places.some((existing) => existing.id === place.id)) {
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    const trip = { ...stored.trip, places: [...stored.trip.places, place] };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * One-click guide import: ordered, provenance-verified places are spread
   * across trip days in a single transaction, each stop getting a check-in
   * task linked to its item. Recomputing every affected day draws the route
   * lines immediately.
   */
  async importRoute(raw: unknown) {
    const input = importRouteInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const totalPlaces = input.assignments.reduce((total, assignment) => total + assignment.places.length, 0);
    if (totalPlaces > 20) throw new SkillError("INVALID_INPUT", "一次最多导入 20 个地点");

    let trip = structuredClone(stored.trip);
    const touchedDays = new Set<string>();
    let importedCount = 0;
    for (const assignment of input.assignments) {
      if (!trip.days.some((day) => day.id === assignment.dayId)) {
        throw new SkillError("INVALID_INPUT", `目标日期不存在：${assignment.dayId}`);
      }
      let order = trip.items.filter((item) => item.dayId === assignment.dayId).length;
      for (const place of assignment.places) {
        if (!placeProvenanceVerified(place)) {
          throw new SkillError("PLACE_SOURCE_UNVERIFIED", `「${place.name}」缺少可核实的真实数据来源，不能导入`);
        }
        const duplicate = trip.items.some((item) => item.dayId === assignment.dayId && item.placeId === place.id);
        if (duplicate) continue;
        if (!trip.places.some((existing) => existing.id === place.id)) trip.places.push(place);
        const itemId = crypto.randomUUID();
        trip.items.push({
          id: itemId,
          dayId: assignment.dayId,
          type: itemType(place),
          placeId: place.id,
          startTime: "10:00",
          duration: place.stayMinutes || 60,
          order,
          status: "planned",
        });
        order += 1;
        touchedDays.add(assignment.dayId);
        importedCount += 1;
        if (input.createTasks && !trip.tasks.some((task) => task.dayId === assignment.dayId && task.placeId === place.id)) {
          trip.tasks.push({
            id: crypto.randomUUID(),
            tripId: input.tripId,
            dayId: assignment.dayId,
            placeId: place.id,
            linkedItemId: itemId,
            title: place.name,
            group: "day",
            status: "todo",
            checkin: true,
          });
        }
      }
    }
    if (!importedCount) {
      // Every place was already on the plan — nothing to write, no revision bump.
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    for (const dayId of touchedDays) {
      trip = recomputeDay(trip, dayId);
    }
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({
      tripId: input.tripId,
      trip: saved.trip,
      revision: saved.revision,
      tripHash: saved.hash,
      importedCount,
    });
  }

  async setTaskStatus(raw: unknown) {
    const input = setTaskStatusInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const task = stored.trip.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) throw new SkillError("INVALID_INPUT", "任务不存在");
    if (task.status === input.status) {
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    const trip = {
      ...stored.trip,
      tasks: stored.trip.tasks.map((candidate) => candidate.id === input.taskId ? { ...candidate, status: input.status } : candidate),
    };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async setItemStatus(raw: unknown) {
    const input = setItemStatusInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const item = stored.trip.items.find((candidate) => candidate.id === input.itemId);
    if (!item) throw new SkillError("INVALID_INPUT", "行程条目不存在");
    if (item.status === input.status) {
      return successEnvelope({ tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
    }
    // Check-in linkage: ticking a stop off also ticks (or unticks, symmetrically)
    // its linked check-in task, so the checklist strikes itself through.
    const taskStatus: TaskStatus = input.status === "done" ? "done" : "todo";
    const trip = {
      ...stored.trip,
      items: stored.trip.items.map((candidate) => candidate.id === input.itemId ? { ...candidate, status: input.status } : candidate),
      tasks: stored.trip.tasks.map((task) => {
        const linked = task.linkedItemId === item.id
          || (Boolean(task.checkin) && task.dayId === item.dayId && task.placeId === item.placeId);
        return linked ? { ...task, status: taskStatus } : task;
      }),
    };
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * Removing a stop from its day. The check-in task attached to the stop goes
   * with it (same linkage rule as setItemStatus, applied symmetrically) and
   * the day is recomputed so timings and segments stay consistent.
   */
  async removeItem(raw: unknown) {
    const input = removeItemInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const item = stored.trip.items.find((candidate) => candidate.id === input.itemId);
    if (!item) throw new SkillError("INVALID_INPUT", "行程条目不存在");
    let trip: Trip = {
      ...stored.trip,
      items: stored.trip.items.filter((candidate) => candidate.id !== input.itemId),
      tasks: stored.trip.tasks.filter((task) => {
        const linked = task.linkedItemId === item.id
          || (Boolean(task.checkin) && task.dayId === item.dayId && task.placeId === item.placeId);
        return !linked;
      }),
    };
    trip = recomputeDay(trip, item.dayId);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  /**
   * Removing an entire day. The day's items, tasks and cross-item segments go
   * with it, remaining days are re-indexed (Day N stays contiguous), and a
   * full recompute keeps timing and segments consistent afterwards. Places
   * survive the deletion — a place may be a map bookmark or referenced
   * elsewhere, and remove-item never deletes places either.
   */
  async removeDay(raw: unknown) {
    const input = removeDayInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const day = stored.trip.days.find((candidate) => candidate.id === input.dayId);
    if (!day) throw new SkillError("INVALID_INPUT", "行程天不存在");
    if (stored.trip.days.length <= 1) throw new SkillError("INVALID_INPUT", "至少要保留一天行程");
    const dayItemIds = new Set(stored.trip.items.filter((item) => item.dayId === input.dayId).map((item) => item.id));
    let trip: Trip = {
      ...stored.trip,
      days: stored.trip.days.filter((candidate) => candidate.id !== input.dayId).map((candidate, index) => ({ ...candidate, index })),
      items: stored.trip.items.filter((item) => item.dayId !== input.dayId),
      tasks: stored.trip.tasks.filter((task) => task.dayId !== input.dayId),
      segments: stored.trip.segments.filter((segment) => segment.dayId !== input.dayId && !dayItemIds.has(segment.fromItemId) && !dayItemIds.has(segment.toItemId)),
    };
    // The trips list and the trip header render the span from startDate and
    // endDate — deleting the first or last day would otherwise leave a range
    // that advertises days that no longer exist.
    if (trip.days.length) {
      const dates = trip.days.map((day) => day.date).sort();
      trip = { ...trip, startDate: dates[0]!, endDate: dates[dates.length - 1]! };
    }
    trip = recomputeTrip(trip);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async proposeChange(raw: unknown) {
    const input = proposeChangeInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");

    const transportContext = transportContextFromInstruction(input.instruction, stored.trip);
    if (transportContext) {
      const requestedTransportDay = input.dayId
        ?? resolveRequestedDay(stored.trip, input.instruction, currentDayId(stored.trip, input.asOf));
      const replanned = await this.replanTrip({
        tripId: input.tripId,
        dayId: requestedTransportDay,
        instruction: input.instruction,
        context: transportContext,
        fallbackPolicy: input.fallbackPolicy,
      }) as { data?: { proposalId?: string | null } };
      if (replanned.data?.proposalId) return replanned;
    }

    const provider = await this.providerFactory();
    const original = stored.trip;
    const locked = lockedItemIds(original);
    const fallbackDay = input.dayId ?? currentDayId(original, input.asOf);
    const working = structuredClone(original);
    let actionPlan = planActionsWithRules(working, input.instruction, fallbackDay);

    if (/雨|室内/.test(input.instruction)) {
      const dayId = resolveRequestedDay(working, input.instruction, fallbackDay);
      const target = working.items
        .filter((item) => item.dayId === dayId && item.status === "planned")
        .sort((a, b) => a.order - b.order)
        .find((item) => isOutdoor(working.places.find((place) => place.id === item.placeId)!));
      let indoor = working.places.find((place) => isIndoor(place) && !working.items.some((item) => item.placeId === place.id));
      if (!indoor) {
        const found = await provider.searchPlaces({ destination: working.destination, query: "室内 博物馆 美术馆", category: "activity", limit: 12 });
        indoor = found.find((place) => isIndoor(place)) ?? found[0];
        if (indoor) working.places.push(indoor);
      }
      if (dayId && target && indoor) actionPlan = { actions: [{ type: "REPLACE_ITEM", payload: { itemId: target.id, placeId: indoor.id } }], summary: input.instruction };
    }

    const execution = executeActions(working, actionPlan.actions);
    if (!execution.applied.length) throw new SkillError("INVALID_INPUT", "No action could be applied", execution.rejected);
    const affectedDays = new Set<string>();
    for (const action of execution.applied) {
      const payload = action.payload as { dayId?: string; itemId?: string; toDayId?: string };
      const item = payload.itemId ? original.items.find((candidate) => candidate.id === payload.itemId) : undefined;
      if (payload.dayId) affectedDays.add(payload.dayId);
      if (payload.toDayId) affectedDays.add(payload.toDayId);
      if (item) affectedDays.add(item.dayId);
    }
    let proposed = execution.trip;
    let routeStatus: ProviderLevel = provider.kind === "amap" ? "REAL" : "MOCK";
    const warnings: string[] = [];
    for (const dayId of affectedDays) {
      const routed = await enrichRoutes(proposed, provider, input.fallbackPolicy === "estimated", dayId);
      proposed = routed.trip;
      routeStatus = routed.level;
      warnings.push(...routed.warnings);
    }
    proposed = restoreLockedItems(original, proposed, locked);
    const changeSet = computeTripChangeSet(original, proposed, execution.applied, actionPlan.summary);
    const { record: proposal, token } = await this.repository.saveProposal({
      tripId: original.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions: execution.applied,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope({ proposalId: proposal.id, proposalToken: token, tripId: original.id, baseRevision: proposal.baseRevision, actions: proposal.actions, changes: proposal.changeSet, summary: proposal.changeSet.summary }, status(placeLevel(provider), routeStatus, "UNKNOWN"), warnings);
  }

  async applyChange(raw: unknown) {
    if (!raw || typeof raw !== "object" || (raw as { confirmed?: unknown }).confirmed !== true) {
      throw new SkillError("CONFIRMATION_REQUIRED", "Explicit confirmed=true is required");
    }
    if (typeof (raw as { proposalToken?: unknown }).proposalToken !== "string") {
      throw new SkillError("PROPOSAL_TOKEN_REQUIRED", "proposalToken from propose-change is required to apply");
    }
    const input = applyChangeInputSchema.parse(raw);
    const stored = await this.repository.applyProposal(input);
    return successEnvelope({ tripId: input.tripId, proposalId: input.proposalId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
  }

  /**
   * Itinerary Optimizer v1: reschedules planned items into a geographically
   * clustered plan that respects day-part placement and the user's profile.
   * Always produces a proposal (Diff + proposalToken)
   * for the user to confirm — the optimizer never writes the trip directly.
   */
  async optimizeItinerary(raw: unknown) {
    const input = optimizeItineraryInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");

    const result = optimizeTripPlan({ trip: stored.trip });
    const optimizationEnvelope = {
      decisions: result?.optimization.decisions ?? [],
      warnings: result?.optimization.warnings ?? [],
      unresolvedConstraints: result?.optimization.unresolvedConstraints ?? [],
      estimatedWalkingMetersByDay: result?.optimization.metrics.estimatedWalkingMetersByDay ?? {},
    };
    if (!result || !result.changedDayIds.length) {
      return successEnvelope(
        {
          tripId: input.tripId,
          changed: false,
          message: result ? "当前安排已是优化器的最优解，未生成提案" : "没有可重排的 planned 行程项",
          optimization: optimizationEnvelope,
        },
        status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      );
    }

    let proposed = result.trip;
    for (const dayId of result.changedDayIds) {
      proposed = recomputeDay(proposed, dayId);
    }
    const actions: TravelAction[] = result.changedDayIds.map((dayId) => ({ type: "OPTIMIZE_DAY" as const, payload: { dayId } }));
    const changeSet = computeTripChangeSet(stored.trip, proposed, actions, "智能排程优化：按地理位置聚类、时间窗与偏好重排");
    const { record: proposal, token } = await this.repository.saveProposal({
      tripId: stored.trip.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope(
      {
        proposalId: proposal.id,
        proposalToken: token,
        tripId: input.tripId,
        baseRevision: proposal.baseRevision,
        actions,
        changes: changeSet,
        summary: changeSet.summary,
        optimization: optimizationEnvelope,
      },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    );
  }

  /**
   * Today Mode v2: the execution console's single source of truth. Read-only;
   * deterministic rules only — lateness, remaining walking, next-hop
   * distance, weather — every suggestion maps to a user-initiated
   * propose-change, never a direct write.
   */
  async getTodayContext(raw: unknown) {
    const input = getTodayContextInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    let context;
    try {
      context = buildTodayContext(stored.trip, { dayId: input.dayId, asOf: input.asOf });
    } catch {
      throw new SkillError("TRIP_NOT_FOUND", "Trip has no days");
    }
    return successEnvelope(
      { tripId: input.tripId, ...context },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, context.weather?.provenance?.source === "amap" ? "REAL" : "UNKNOWN"),
      [],
      context.weather?.provenance ? { source: context.weather.provenance.source } : undefined,
    );
  }

  async getPlace(raw: unknown) {
    const input = getPlaceInputSchema.parse(raw);
    if (input.tripId && input.placeId) {
      const stored = await this.repository.getTrip(input.tripId);
      if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
      const place = stored.trip.places.find((candidate) => candidate.id === input.placeId);
      if (!place) throw new SkillError("PLACE_NOT_FOUND", "Place not found in trip");
      return successEnvelope({ place, matchBasis: "trip_lookup" as const }, status("UNKNOWN", "UNKNOWN", "UNKNOWN"));
    }
    const provider = await this.providerFactory();
    const places = uniquePlaces(await provider.searchPlaces({ destination: input.city!, query: input.name!, category: undefined, limit: 5 }).catch((error) => {
      throw normalizeProviderError(error, "NO_POI_RESULTS");
    }));
    if (!places.length) throw new SkillError("NO_POI_RESULTS", "No matching places found");
    const name = input.name!.trim();
    const best = places.find((place) => place.name === name)
      ?? places.find((place) => place.name.includes(name) || name.includes(place.name))
      ?? places[0];
    return successEnvelope({ place: best, matchBasis: "provider_search" as const }, status(placeLevel(provider), "UNKNOWN", "UNKNOWN"));
  }

  async updateTrip(raw: unknown) {
    const input = updateTripInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (stored.revision !== input.expectedTripRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const { patch } = input;
    let trip: Trip = { ...stored.trip, ...patch, updatedAt: new Date().toISOString() };
    if (patch.budget !== undefined) {
      trip = estimateBudgetItems({ ...trip, estimatedSpend: Math.round(patch.budget * 0.85) });
    }
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope(
      { tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash, changedFields: Object.keys(patch) },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      [],
      { source: "user_patch" },
    );
  }

  async searchSocial(raw: unknown) {
    const input = searchSocialInputSchema.parse(raw);
    const collected = await collectSocialObservations(this.socialRouterFactory(), { city: input.city, query: input.query, platform: input.platform, limit: input.limit });
    const observations = recentRelevantObservations({ city: input.city, poi: input.poi }, collected.observations);
    const { evidence, signals } = buildSocialEvidence({ city: input.city, poi: input.poi, observations });
    const level = socialLevelFromStatuses(collected.platformStatus, observations.length);
    const warnings = collected.warnings;
    return successEnvelope(
      { city: input.city, queryId: socialQueryId(input), evidence, signals, platformStatus: collected.platformStatus, warnings },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, level),
      warnings,
    );
  }

  async getSocialTrending(raw: unknown) {
    const input = getSocialTrendingInputSchema.parse(raw);
    const collected = await collectSocialObservations(this.socialRouterFactory(), { city: input.city, platform: input.platform, limit: input.limit, operation: "getTrending" });
    const ranked = recentRelevantObservations({ city: input.city }, collected.observations)
      .sort((a, b) => socialEngagement(b) - socialEngagement(a))
      .slice(0, input.limit);
    const { evidence, signals } = buildSocialEvidence({ city: input.city, observations: ranked });
    const level = socialLevelFromStatuses(collected.platformStatus, ranked.length);
    const warnings = collected.warnings;
    return successEnvelope(
      { city: input.city, queryId: socialQueryId(input), evidence, signals, platformStatus: collected.platformStatus, warnings },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, level),
      warnings,
    );
  }

  async getSocialEvidence(raw: unknown) {
    const input = getSocialEvidenceInputSchema.parse(raw);
    let places: Array<{ id: string; name: string }> = [];
    if (input.tripId) {
      const stored = await this.repository.getTrip(input.tripId);
      if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
      places = stored.trip.places.map((place) => ({ id: place.id, name: place.name }));
    } else if (input.poi) {
      try {
        const provider = await this.providerFactory();
        places = uniquePlaces(await provider.searchPlaces({ destination: input.city, query: input.poi, category: undefined, limit: 8 }))
          .map((place) => ({ id: place.id, name: place.name }));
      } catch (error) {
        logger.warn("social.evidence_poi_search_failed", { city: input.city, poi: input.poi, error });
        places = [];
      }
    }
    const query = [input.poi, input.query].filter(Boolean).join(" ").trim() || undefined;
    const collected = await collectSocialObservations(this.socialRouterFactory(), { city: input.city, query, limit: input.limit });
    const observations = recentRelevantObservations({ city: input.city, poi: input.poi }, collected.observations);
    const { evidence, signals } = buildSocialEvidence({ city: input.city, poi: input.poi, observations, places });
    const context = buildSocialContext({ city: input.city, poi: input.poi, query: input.query }, signals);
    const level = socialLevelFromStatuses(collected.platformStatus, observations.length);
    const warnings = [...collected.warnings, ...context.warnings.map((message) => `social: ${message}`)];
    return successEnvelope(
      { city: input.city, queryId: socialQueryId(input), evidence, signals, context, platformStatus: collected.platformStatus, warnings },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN", undefined, level),
      warnings,
    );
  }

  async execute(command: SkillCommand, input: unknown) {
    switch (command) {
      case "create-trip": return this.createTrip(input);
      case "get-trip": return this.getTrip(input);
      case "search-places": return this.searchPlaces(input);
      case "plan-route": return this.planRoute(input);
      case "get-route-options": return this.getRouteOptions(input);
      case "optimize-transport": return this.optimizeTransport(input);
      case "retrieve-travel-knowledge": return this.retrieveTravelKnowledge(input);
      case "replan-trip": return this.replanTrip(input);
      case "get-weather": return this.getWeather(input);
      case "search-flights": return this.searchFlights(input);
      case "search-travel-offers": return this.searchTravelOffers(input);
      case "refresh-travel-offers": return this.refreshTravelOffers(input);
      case "reorder-day": return this.reorderDay(input);
      case "add-place-item": return this.addPlaceItem(input);
      case "set-item-status": return this.setItemStatus(input);
      case "remove-item": return this.removeItem(input);
      case "remove-day": return this.removeDay(input);
      case "add-place": return this.addPlace(input);
      case "restore-trip": return this.restoreTrip(input);
      case "import-route": return this.importRoute(input);
      case "set-task-status": return this.setTaskStatus(input);
      case "propose-change": return this.proposeChange(input);
      case "apply-change": return this.applyChange(input);
      case "optimize-itinerary": return this.optimizeItinerary(input);
      case "get-today-context": return this.getTodayContext(input);
      case "get-place": return this.getPlace(input);
      case "update-trip": return this.updateTrip(input);
      case "search-social": return this.searchSocial(input);
      case "get-social-trending": return this.getSocialTrending(input);
      case "get-social-evidence": return this.getSocialEvidence(input);
    }
  }
}

export function createRuntime(
  dataDir = process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage"),
  repositoryOptions: { proposalTtlSec?: number } = {},
) {
  return new VoyageSkillRuntime(new JsonSkillRepository(dataDir, repositoryOptions));
}
