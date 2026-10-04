import type { TravelEvent, TravelEventInput, TravelEventType } from "@/schemas/travel-event";
import type { Trip } from "@/types/travel";

/**
 * Event Provider interfaces (Phase 6.8).
 *
 * The Runtime never sees raw provider responses: every source normalizes into
 * TravelEvents first (Provider → normalize → TravelEvent → record). Four
 * delivery modes are supported by design — webhook (push into the same
 * interface), polling via `poll()`, manual user reports, and simulation via
 * MockTravelEventProvider — so the whole Event → Impact → Replan chain is
 * testable end-to-end without any paid API.
 */

/** Normalized weather provider observation. */
export interface WeatherObservation {
  date: string;
  condition: string;
  tempC: number;
  /** Set only when the observation changed vs the previously known forecast. */
  previousCondition?: string;
  fetchedAt: string;
}

/** Normalized flight status report (vendor-agnostic; e.g. FlightAware later). */
export interface FlightStatus {
  /** Airline flight designator, e.g. "CA1468". */
  flightNo: string;
  status: "scheduled" | "delayed" | "cancelled" | "diverted" | "arrived";
  departureAt?: string;
  arrivalAt?: string;
  delayMinutes?: number;
  gate?: string;
  /** Vendor provenance. */
  provider: string;
  fetchedAt: string;
  confidence: number;
}

export interface WeatherEventProvider {
  readonly kind: "weather";
  /** Fetch current observations and normalize them into events. */
  poll(trip: Trip, options?: { asOf?: string }): Promise<TravelEventInput[]>;
  /** Deterministic mapping used by poll() and webhook ingestion alike. */
  normalize(observation: WeatherObservation, trip: Trip): TravelEventInput;
}

export interface FlightEventProvider {
  readonly kind: "flight";
  /** Poll flight status for every confirmed flight reservation on the trip. */
  poll(trip: Trip, options?: { asOf?: string }): Promise<TravelEventInput[]>;
  normalize(status: FlightStatus, trip: Trip, reservationId?: string): TravelEventInput;
}

/** Condition keywords → event type. Unknown conditions degrade honestly. */
export function classifyWeatherCondition(condition: string): { type: TravelEventType; severity: "info" | "warning" | "critical" } {
  if (/暴雨|大雨|雷暴|storm|heavy rain/i.test(condition)) return { type: "HEAVY_RAIN", severity: "critical" };
  if (/雨|阵雨|rain|drizzle/i.test(condition)) return { type: "WEATHER_CHANGED", severity: "warning" };
  if (/高温|酷热|heat wave|extreme heat/i.test(condition)) return { type: "EXTREME_HEAT", severity: "warning" };
  return { type: "WEATHER_CHANGED", severity: "info" };
}

export const weatherEventProvider: WeatherEventProvider = {
  kind: "weather",
  async poll(trip) {
    // Wired to the existing AMap weather source via the runtime's
    // get-weather command at the call site (the runtime owns provider
    // construction). This default implementation returns nothing — real
    // polling is orchestrated by the runtime/env, simulation goes through
    // MockTravelEventProvider.
    void trip;
    return [];
  },
  normalize(observation, _trip) {
    const classified = classifyWeatherCondition(observation.condition);
    const changed = observation.previousCondition !== undefined && observation.previousCondition !== observation.condition;
    return {
      type: classified.type,
      severity: classified.severity,
      source: "provider",
      effectiveFrom: `${observation.date}T00:00:00+08:00`,
      effectiveUntil: `${observation.date}T23:59:59+08:00`,
      summary: changed
        ? `${observation.date} 天气由「${observation.previousCondition}」变为「${observation.condition}」${observation.tempC}°C`
        : `${observation.date} 天气：${observation.condition} ${observation.tempC}°C`,
      payload: { condition: observation.condition, tempC: observation.tempC, date: observation.date },
      relatedEntities: [],
      confidence: 0.9,
      estimated: false,
      // tripId is stamped by the runtime when the event is recorded.
    };
  },
};

export const flightEventProvider: FlightEventProvider = {
  kind: "flight",
  async poll(trip) {
    // Future: FlightAware AeroAPI / vendor webhook receiver. No vendor is
    // wired by default — the interface exists so the Runtime never binds to one.
    void trip;
    return [];
  },
  normalize(status, _trip, reservationId) {
    if (status.status === "delayed") {
      return {
        type: "FLIGHT_DELAYED",
        severity: "critical",
        source: "provider",
        summary: `航班 ${status.flightNo} 延误${typeof status.delayMinutes === "number" ? ` ${status.delayMinutes} 分钟` : ""}`,
        payload: { flightNo: status.flightNo, delayMinutes: status.delayMinutes ?? null, gate: status.gate ?? null, provider: status.provider },
        relatedEntities: reservationId ? [{ kind: "reservation", id: reservationId }] : [],
        confidence: status.confidence,
        estimated: false,
      };
    }
    if (status.status === "cancelled" || status.status === "diverted") {
      return {
        type: "FLIGHT_CANCELLED",
        severity: "critical",
        source: "provider",
        summary: `航班 ${status.flightNo} ${status.status === "diverted" ? "备降" : "取消"}`,
        payload: { flightNo: status.flightNo, status: status.status, provider: status.provider },
        relatedEntities: reservationId ? [{ kind: "reservation", id: reservationId }] : [],
        confidence: status.confidence,
        estimated: false,
      };
    }
    return {
      type: "RESERVATION_CHANGED",
      severity: "info",
      source: "provider",
      summary: `航班 ${status.flightNo} 状态：${status.status}`,
      payload: { flightNo: status.flightNo, status: status.status, departureAt: status.departureAt ?? null, arrivalAt: status.arrivalAt ?? null },
      relatedEntities: reservationId ? [{ kind: "reservation", id: reservationId }] : [],
      confidence: status.confidence,
      estimated: false,
    };
  },
};

/**
 * Simulation provider (dev/demo): emits a scripted event on demand so the
 * Event → Impact → Replan chain can be exercised without paid APIs. Never
 * claims provider provenance — the runtime stamps source="simulation".
 */
export class MockTravelEventProvider {
  readonly kind = "mock";

  flightDelay(flightNo: string, delayMinutes: number, reservationId?: string): TravelEventInput {
    return flightEventProvider.normalize({
      flightNo,
      status: "delayed",
      delayMinutes,
      provider: "simulation",
      fetchedAt: new Date().toISOString(),
      confidence: 1,
    }, undefined as never, reservationId);
  }

  heavyRain(date: string, untilHHmm = "18:00"): TravelEventInput {
    return {
      type: "HEAVY_RAIN",
      severity: "critical",
      source: "simulation",
      summary: `${date} 午后暴雨（模拟）`,
      effectiveFrom: `${date}T14:00:00+08:00`,
      effectiveUntil: `${date}T${untilHHmm}:00+08:00`,
      payload: { condition: "暴雨", date },
      relatedEntities: [],
      confidence: 1,
      estimated: false,
    };
  }

  poiClosed(placeId: string, date: string, reopeningAt?: string): TravelEventInput {
    return {
      type: "POI_CLOSED",
      severity: "warning",
      source: "simulation",
      summary: `景点临时关闭（模拟）`,
      effectiveFrom: `${date}T00:00:00+08:00`,
      ...(reopeningAt ? { effectiveUntil: reopeningAt } : {}),
      payload: { placeId, date },
      relatedEntities: [{ kind: "place", id: placeId }],
      confidence: 1,
      estimated: false,
    };
  }

  userLate(minutes: number, date: string): TravelEventInput {
    return {
      type: "USER_LATE",
      severity: minutes > 60 ? "critical" : "warning",
      source: "simulation",
      summary: `用户比计划晚 ${minutes} 分钟（模拟）`,
      effectiveFrom: `${date}T00:00:00+08:00`,
      payload: { minutes, date },
      relatedEntities: [],
      confidence: 1,
      estimated: false,
    };
  }

  roadCongested(segmentId: string, date: string): TravelEventInput {
    return {
      type: "ROAD_CONGESTED",
      severity: "warning",
      source: "simulation",
      summary: "道路拥堵（模拟）",
      effectiveFrom: `${date}T00:00:00+08:00`,
      payload: { segmentId, date },
      relatedEntities: [{ kind: "segment", id: segmentId }],
      confidence: 1,
      estimated: false,
    };
  }
}

/** Normalize helper used by the runtime's simulate command. */
export function eventInputFromSimulation(input: TravelEventInput): TravelEventInput {
  // The simulation provider is authoritative about its own nature: force the
  // source so a simulated storm can never be presented as a real forecast.
  return { ...input, source: "simulation" };
}

export type { TravelEvent };
