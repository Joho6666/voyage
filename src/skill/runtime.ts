import path from "node:path";
import { executeActions, estimateBudgetItems } from "@/services/ai/actions/executor";
import type { TravelAction } from "@/services/ai/actions/types";
import { buildRouteOptionSet } from "@/services/transport/options";
import { retrieveTravelKnowledge } from "@/services/knowledge/retriever";
import type { ScoredTransportOption, TransportContext } from "@/types/transport-intelligence";
import { planActionsWithRules, resolveRequestedDay } from "@/services/ai/actions/rule-planner";
import { computeTripChangeSet } from "@/services/ai/diff";
import { haversineMeters, estimateTransit } from "@/lib/utils";
import { createTripId, planWithRules } from "@/services/planning/rule-planner";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import { weatherForDate } from "@/services/weather/merge";
import type { Day, ItineraryItem, Place, RouteSegment, Trip } from "@/types/travel";
import {
  applyChangeInputSchema,
  createTripInputSchema,
  getTripInputSchema,
  getWeatherInputSchema,
  getRouteOptionsInputSchema,
  optimizeTransportInputSchema,
  retrieveTravelKnowledgeInputSchema,
  replanTripInputSchema,
  searchFlightsInputSchema,
  searchTravelOffersInputSchema,
  refreshTravelOffersInputSchema,
  planRouteInputSchema,
  proposeChangeInputSchema,
  searchPlacesInputSchema,
  reorderDayInputSchema,
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

const DAY_MS = 86_400_000;

function endDate(startDate: string, days: number) {
  return new Date(new Date(`${startDate}T12:00:00Z`).getTime() + (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(startDate: string, finishDate: string) {
  return Math.max(1, Math.min(7, Math.floor((new Date(`${finishDate}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) / DAY_MS) + 1));
}

function overall(levels: ProviderLevel[]): ProviderLevel {
  if (levels.includes("UNAVAILABLE")) return "UNAVAILABLE";
  if (levels.includes("UNSTRUCTURED")) return "UNSTRUCTURED";
  if (levels.includes("MOCK")) return "MOCK";
  if (levels.includes("UNKNOWN")) return "UNKNOWN";
  if (levels.includes("ESTIMATED")) return "ESTIMATED";
  return "REAL";
}

function status(places: ProviderLevel, routes: ProviderLevel, weather: ProviderLevel, travelOffers?: ProviderLevel): ProviderStatus {
  return { overall: overall([places, routes, weather, ...(travelOffers ? [travelOffers] : [])]), places, routes, weather, travelOffers: travelOffers ?? "UNKNOWN" };
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

async function enrichRoutes(trip: Trip, provider: TravelDataProvider, allowEstimate: boolean, onlyDayId?: string) {
  let next = onlyDayId ? recomputeDay(trip, onlyDayId) : recomputeTrip(trip);
  const dayIds = onlyDayId ? [onlyDayId] : next.days.map((day) => day.id);
  let level: ProviderLevel = provider.kind === "amap" ? "REAL" : "MOCK";
  const warnings: string[] = [];

  for (const dayId of dayIds) {
    const items = next.items.filter((item) => item.dayId === dayId).sort((a, b) => a.order - b.order);
    const resolved: RouteSegment[] = [];
    for (let index = 0; index < items.length - 1; index += 1) {
      const from = items[index];
      const to = items[index + 1];
      const fromPlace = next.places.find((place) => place.id === from.placeId);
      const toPlace = next.places.find((place) => place.id === to.placeId);
      if (!fromPlace || !toPlace) continue;
      const baseline = next.segments.find((segment) => segment.dayId === dayId && segment.fromItemId === from.id && segment.toItemId === to.id);
      const mode = baseline?.mode === "highspeed" || baseline?.mode === "flight" ? "taxi" : baseline?.mode ?? "walk";
      try {
        const route = await provider.planRoute({ origin: fromPlace, destination: toPlace, mode, city: next.destination });
        resolved.push(routeSegment({ trip: next, dayId, from, to, fromPlace, toPlace, route, estimated: provider.kind !== "amap" }));
      } catch (error) {
        if (!allowEstimate) throw normalizeProviderError(error, "ROUTE_PROVIDER_UNAVAILABLE");
        const route = estimateRoute(fromPlace, toPlace, mode);
        resolved.push(routeSegment({ trip: next, dayId, from, to, fromPlace, toPlace, route, estimated: true }));
        level = "ESTIMATED";
        warnings.push(`Route ${fromPlace.name} → ${toPlace.name} uses Haversine estimation`);
      }
    }
    next = { ...next, segments: [...next.segments.filter((segment) => segment.dayId !== dayId), ...resolved] };
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
  // AMap Web Service keys commonly have a low QPS limit. Avoid firing all
  // category searches concurrently during trip creation; this also keeps the
  // provider boundary predictable for other rate-limited implementations.
  const results: Place[][] = [];
  for (const [index, [query, category]] of groups.entries()) {
    if (provider.kind === "amap" && index > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    results.push(await provider.searchPlaces({ destination, query, category, limit: 12 }));
  }
  const candidates = uniquePlaces(results.flat());
  if (candidates.length < 4) throw new SkillError("NO_POI_RESULTS", `Only ${candidates.length} valid POIs were returned`);
  return candidates;
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

function restoreLockedItems(original: Trip, proposed: Trip, locked: Set<string>) {
  const originals = new Map(original.items.filter((item) => locked.has(item.id)).map((item) => [item.id, item]));
  return { ...proposed, items: proposed.items.map((item) => originals.get(item.id) ?? item) };
}

export class VoyageSkillRuntime {
  constructor(
    private readonly repository: JsonSkillRepository,
    private readonly providerFactory: () => Promise<TravelDataProvider> = providerFromEnvironment,
  ) {}

  async createTrip(raw: unknown) {
    const input = createTripInputSchema.parse(raw);
    const provider = await this.providerFactory();
    const finish = input.endDate ?? endDate(input.startDate, input.days ?? 1);
    const candidates = await collectCandidates(provider, input.destination).catch((error) => {
      throw normalizeProviderError(error, "NO_POI_RESULTS");
    });
    const forecasts = await provider.getWeather(input.destination).catch((error) => {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
      return [];
    });
    const tripId = createTripId();
    const count = daysBetween(input.startDate, finish);
    const plan = planWithRules({
      destination: input.destination,
      startDate: input.startDate,
      endDate: finish,
      travelers: input.travelers ?? input.people,
      budget: input.budget,
      vibes: input.vibes ?? input.preferences,
      candidates,
    });
    const days: Day[] = Array.from({ length: count }, (_, index) => {
      const date = endDate(input.startDate, index + 1);
      return {
        id: `${tripId}-day-${index + 1}`,
        tripId,
        index,
        date,
        title: plan.dayPlans[index]?.title ?? `Day ${index + 1}`,
        summary: plan.dayPlans[index]?.summary ?? "",
        weather: weatherForDate(forecasts, date),
      };
    });
    const selected = new Map<string, Place>();
    const items: ItineraryItem[] = [];
    plan.dayPlans.forEach((dayPlan, dayIndex) => dayPlan.stops.forEach((stop, order) => {
      const place = candidates.find((candidate) => candidate.id === stop.placeId);
      if (!place) return;
      selected.set(place.id, place);
      items.push({
        id: crypto.randomUUID(), dayId: days[dayIndex].id, type: itemType(place), placeId: place.id,
        startTime: stop.startTime, duration: stop.durationMinutes, order, status: "planned", ...(stop.meal ? { meal: stop.meal } : {}),
      });
    }));
    let trip: Trip = {
      id: tripId, title: plan.title, destination: input.destination, origin: input.origin, startDate: input.startDate, endDate: finish,
      travelers: input.travelers ?? input.people, budget: input.budget, currency: "CNY", status: "ready",
      estimatedSpend: Math.round(input.budget * 0.85), coverImage: "", vibe: input.vibes ?? input.preferences,
      prompt: input.prompt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), days, items,
      segments: [], places: candidates, hotels: [], restaurants: [], activities: [], transports: [], tasks: [], budgetItems: [],
    };
    trip = estimateBudgetItems(trip);
    const routePromise = enrichRoutes(trip, provider, input.fallbackPolicy === "estimated");
    const offerPromise = input.includeExternalOffers
      ? queryMeituan({
          origin: input.origin,
          destination: input.destination,
          startDate: input.startDate,
          endDate: finish,
          travelers: input.travelers ?? input.people,
          budget: input.budget,
          query: input.prompt || `推荐${input.destination}的交通、酒店、景点门票、美食和优惠`,
          city: input.destination,
          categories: input.offerCategories,
        }).then((result) => ({ result })).catch((error: unknown) => ({ error }))
      : Promise.resolve({ result: null as Awaited<ReturnType<typeof queryMeituan>> | null });
    const [routed, offerOutcome] = await Promise.all([routePromise, offerPromise]);
    let finalTrip = routed.trip;
    let offerLevel: ProviderLevel = "UNKNOWN";
    const offerWarnings: string[] = [];
    if (input.includeExternalOffers) {
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
    const providerStatus = status(placeLevel(provider), routed.level, weatherLevel(provider, missingWeather), input.includeExternalOffers ? offerLevel : undefined);
    return successEnvelope({ tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash }, providerStatus, [...routed.warnings, ...offerWarnings]);
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
    const knowledge = retrieveTravelKnowledge({
      city: input.city,
      query: "城市地形 市内交通 步行 换乘 天气 疲劳 行李",
      tags: ["transport", "walking"],
      limit: 6,
    });
    const effectiveContext = {
      ...input.context,
      walkingTolerance: input.context.walkingTolerance ??
        (knowledge.some((item) => item.tags.includes("terrain")) ? "low" as const : undefined),
    };
    const envelope = await this.getRouteOptions({ ...input, context: effectiveContext }) as {
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
        knowledge,
      },
      envelope.providerStatus,
      envelope.warnings,
    );
  }

  async retrieveTravelKnowledge(raw: unknown) {
    const input = retrieveTravelKnowledgeInputSchema.parse(raw);
    const matches = retrieveTravelKnowledge(input);
    return successEnvelope({
      city: input.city,
      query: input.query,
      matches,
      retrieval: {
        source: "curated-local",
        vectorReady: true,
        note: "Supabase pgvector schema is available; live facts must still come from providers.",
      },
    });
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
    const knowledge = retrieveTravelKnowledge({
      city: original.destination,
      query: "市内交通 路线 步行 换乘 天气 疲劳 行李",
      tags: ["transport", "walking"],
      limit: 6,
    });

    for (const day of targetDays) {
      const dayContext: Partial<TransportContext> = {
        ...input.context,
        travelers: input.context.travelers ?? original.travelers,
        walkingTolerance: input.context.walkingTolerance ??
          (knowledge.some((item) => item.tags.includes("terrain")) ? "low" : undefined),
        weather: input.context.weather ??
          (day.weather.icon === "rain" || day.weather.condition.includes("雨") ? "rain" : "unknown"),
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

    if (!actions.length) {
      return successEnvelope({
        tripId: original.id,
        proposalId: null,
        routePlans,
        knowledge,
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
    const proposal = await this.repository.saveProposal({
      tripId: original.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions: execution.applied,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope({
      proposalId: proposal.id,
      tripId: original.id,
      baseRevision: proposal.baseRevision,
      actions: proposal.actions,
      changes: proposal.changeSet,
      routePlans,
      knowledge,
      summary,
    }, status("UNKNOWN", routeStatus, "UNKNOWN"), warnings);
  }

  async getWeather(raw: unknown) {
    const input = getWeatherInputSchema.parse(raw);
    const provider = await this.providerFactory();
    let forecasts: ProviderForecast[];
    try {
      forecasts = await provider.getWeather(input.destination);
    } catch (error) {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
      forecasts = [];
    }
    const weather = input.dates.map((date) => ({ date, ...weatherForDate(forecasts, date) }));
    const missing = weather.some((item) => item.provenance.source === "unavailable");
    return successEnvelope({ weather }, status("UNKNOWN", "UNKNOWN", weatherLevel(provider, missing)), missing ? ["Weather unavailable for one or more dates"] : []);
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
    const rank = new Map(input.orderedItemIds.map((id, index) => [id, index]));
    const trip = recomputeDay({ ...stored.trip, items: stored.trip.items.map((item) => item.dayId === input.dayId && rank.has(item.id) ? { ...item, order: rank.get(item.id)! } : item) }, input.dayId);
    const saved = await this.repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
    return successEnvelope({ tripId: input.tripId, trip: saved.trip, revision: saved.revision, tripHash: saved.hash });
  }

  async proposeChange(raw: unknown) {
    const input = proposeChangeInputSchema.parse(raw);
    const stored = await this.repository.getTrip(input.tripId);
    if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
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
    const proposal = await this.repository.saveProposal({
      tripId: original.id,
      baseRevision: stored.revision,
      baseHash: stored.hash,
      actions: execution.applied,
      changeSet,
      proposedTrip: proposed,
    });
    return successEnvelope({ proposalId: proposal.id, tripId: original.id, baseRevision: proposal.baseRevision, actions: proposal.actions, changes: proposal.changeSet, summary: proposal.changeSet.summary }, status(placeLevel(provider), routeStatus, "UNKNOWN"), warnings);
  }

  async applyChange(raw: unknown) {
    if (!raw || typeof raw !== "object" || (raw as { confirmed?: unknown }).confirmed !== true) {
      throw new SkillError("CONFIRMATION_REQUIRED", "Explicit confirmed=true is required");
    }
    const input = applyChangeInputSchema.parse(raw);
    const stored = await this.repository.applyProposal(input);
    return successEnvelope({ tripId: input.tripId, proposalId: input.proposalId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash });
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
      case "propose-change": return this.proposeChange(input);
      case "apply-change": return this.applyChange(input);
    }
  }
}

export function createRuntime(dataDir = process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage")) {
  return new VoyageSkillRuntime(new JsonSkillRepository(dataDir));
}
