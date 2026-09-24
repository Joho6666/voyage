import { haversineMeters } from "@/lib/utils";
import type { TravelDataProvider } from "@/skill/providers";
import type {
  RouteOptionSet,
  TransportContext,
  TransportOption,
  UrbanTransportMode,
} from "@/types/transport-intelligence";
import { rankTransportOptions } from "./scoring";

export const URBAN_TRANSPORT_MODES: UrbanTransportMode[] = ["walk", "metro", "bus", "taxi", "drive"];

function estimateCost(mode: UrbanTransportMode, distanceMeters: number, travelers: number) {
  const km = distanceMeters / 1000;
  if (mode === "walk") return { min: 0, max: 0, currency: "CNY" as const, estimated: false };
  if (mode === "bus") return { min: 2 * travelers, max: 4 * travelers, currency: "CNY" as const, estimated: true };
  if (mode === "metro") {
    const each = Math.max(2, Math.min(12, Math.ceil(2 + km * 0.45)));
    return { min: each * travelers, max: each * travelers, currency: "CNY" as const, estimated: true };
  }
  if (mode === "taxi") {
    const fare = Math.max(13, 13 + Math.max(0, km - 3) * 2.2);
    return { min: Math.round(fare), max: Math.round(fare * 1.35 + 3), currency: "CNY" as const, estimated: true };
  }
  const fuel = Math.max(3, km * 0.75);
  return { min: Math.round(fuel), max: Math.round(fuel + 15), currency: "CNY" as const, estimated: true };
}

function routeWalkMeters(
  mode: UrbanTransportMode,
  distanceMeters: number,
  steps?: Array<{ instruction: string; distanceMeters: number }>,
) {
  if (mode === "walk") return distanceMeters;
  if (mode === "taxi" || mode === "drive") return Math.min(150, Math.round(distanceMeters * 0.03));
  if (!steps?.length) return Math.min(800, Math.round(distanceMeters * 0.18));
  const transitWords = /乘坐|地铁|轨道|公交|巴士|号线/;
  return steps
    .filter((step) => !transitWords.test(step.instruction))
    .reduce((sum, step) => sum + (step.distanceMeters || 0), 0);
}

function transfers(mode: UrbanTransportMode, steps?: Array<{ instruction: string }>) {
  if (mode === "walk" || mode === "taxi" || mode === "drive") return 0;
  if (!steps?.length) return 1;
  const rides = steps.filter((step) => /乘坐|地铁|轨道|公交|巴士|号线/.test(step.instruction)).length;
  return Math.max(0, rides - 1);
}

function inferredTransitMode(
  requested: UrbanTransportMode,
  steps?: Array<{ instruction: string }>,
): UrbanTransportMode {
  if (requested !== "metro" && requested !== "bus") return requested;
  const text = (steps ?? []).map((step) => step.instruction).join(" ");
  if (/地铁|轨道|号线/.test(text)) return "metro";
  if (/公交|巴士/.test(text)) return "bus";
  return requested;
}

function fallbackDuration(mode: UrbanTransportMode, distanceMeters: number) {
  const km = distanceMeters / 1000;
  const speed = mode === "walk" ? 4.5 : mode === "metro" ? 24 : mode === "bus" ? 18 : 28;
  return Math.max(2, Math.round((km / speed) * 60 + (mode === "metro" || mode === "bus" ? 8 : 0)));
}

function fallbackOption(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: UrbanTransportMode,
  travelers: number,
  reason: string,
): TransportOption {
  const distanceMeters = Math.round(haversineMeters(origin, destination));
  return {
    id: mode + "-estimated",
    requestedMode: mode,
    mode,
    durationMinutes: fallbackDuration(mode, distanceMeters),
    distanceMeters,
    walkMeters: routeWalkMeters(mode, distanceMeters),
    transferCount: mode === "metro" || mode === "bus" ? 1 : 0,
    cost: estimateCost(mode, distanceMeters, travelers),
    trafficLevel: "unknown",
    crowdLevel: "unknown",
    rainExposure: mode === "walk" ? 1 : mode === "metro" ? 0.22 : mode === "bus" ? 0.30 : 0.10,
    confidence: 0.38,
    source: "haversine",
    estimated: true,
    updatedAt: new Date().toISOString(),
    polyline: [[origin.lng, origin.lat], [destination.lng, destination.lat]],
    warnings: [reason],
  };
}

export async function buildRouteOptionSet(input: {
  provider?: TravelDataProvider;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  city: string;
  context?: Partial<TransportContext>;
  modes?: UrbanTransportMode[];
  allowEstimate: boolean;
}): Promise<RouteOptionSet> {
  const modes = [...new Set(input.modes?.length ? input.modes : URBAN_TRANSPORT_MODES)];
  const travelers = Math.max(1, input.context?.travelers ?? 1);
  const warnings: string[] = [];

  const options = await Promise.all(modes.map(async (requestedMode): Promise<TransportOption> => {
    if (!input.provider) {
      if (!input.allowEstimate) throw new Error("ROUTE_PROVIDER_UNAVAILABLE");
      return fallbackOption(input.origin, input.destination, requestedMode, travelers, "No realtime route provider configured");
    }
    try {
      const route = await input.provider.planRoute({
        origin: input.origin,
        destination: input.destination,
        mode: requestedMode,
        city: input.city,
      });
      const mode = inferredTransitMode(requestedMode, route.steps);
      const distanceMeters = Math.round(route.distanceMeters);
      return {
        id: requestedMode + "-" + route.source + "-" + distanceMeters + "-" + route.durationMinutes,
        requestedMode,
        mode,
        durationMinutes: route.durationMinutes,
        distanceMeters,
        walkMeters: routeWalkMeters(mode, distanceMeters, route.steps),
        transferCount: transfers(mode, route.steps),
        cost: estimateCost(mode, distanceMeters, travelers),
        trafficLevel: "unknown",
        crowdLevel: "unknown",
        rainExposure: mode === "walk" ? 1 : mode === "metro" ? 0.22 : mode === "bus" ? 0.30 : 0.10,
        confidence: input.provider.kind === "amap" ? 0.90 : 0.55,
        source: route.source,
        estimated: input.provider.kind !== "amap",
        updatedAt: new Date().toISOString(),
        polyline: route.polyline,
        steps: route.steps,
        warnings: requestedMode !== mode
          ? ["Requested " + requestedMode + "; provider returned a " + mode + "-dominant integrated transit route"]
          : undefined,
      };
    } catch (error) {
      if (!input.allowEstimate) throw error;
      const message = error instanceof Error ? error.message : "Route provider failed";
      warnings.push(requestedMode + ": realtime route unavailable");
      return fallbackOption(input.origin, input.destination, requestedMode, travelers, message);
    }
  }));

  const ranked = rankTransportOptions(options, input.context);
  const deduped = ranked.filter((option, index, all) =>
    all.findIndex((candidate) =>
      candidate.mode === option.mode &&
      Math.abs(candidate.durationMinutes - option.durationMinutes) <= 1 &&
      Math.abs(candidate.distanceMeters - option.distanceMeters) <= 50,
    ) === index,
  );

  if (!deduped.length) throw new Error("ROUTE_PROVIDER_UNAVAILABLE");
  return {
    city: input.city,
    origin: input.origin,
    destination: input.destination,
    generatedAt: new Date().toISOString(),
    recommendedMode: deduped[0].mode,
    options: deduped,
    warnings,
  };
}
