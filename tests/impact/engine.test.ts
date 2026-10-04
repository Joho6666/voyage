// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";
import type { Reservation } from "@/schemas/reservation";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { analyzeEventImpact } from "@/services/impact-engine";

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Array<{ id: string; name: string; category: string; lat: number; lng: number }>;
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: string; limit: number }) {
    return this.fixture.places
      .filter((place) => !input.category || place.category === input.category)
      .slice(0, input.limit)
      .map((place) => ({ ...place, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } })) as never;
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

function reservation(overrides: Partial<Reservation> & { id: string; type: Reservation["type"]; title: string; startAt: string }): Reservation {
  return {
    tripId: "trip-x",
    status: "confirmed",
    flexibility: "fixed",
    currency: "CNY",
    provenance: { source: "user", fetchedAt: "2030-04-01T00:00:00+08:00", estimated: false },
    ...overrides,
  } as Reservation;
}

function event(overrides: Partial<Parameters<typeof analyzeEventImpact>[0]> & { type: Parameters<typeof analyzeEventImpact>[0]["type"]; occurredAt: string }) {
  return {
    id: "evt-x",
    tripId: "trip-x",
    severity: "warning" as const,
    source: "provider" as const,
    provenance: { source: "provider" as const, fetchedAt: "2030-05-01T00:00:00Z", confidence: 0.9, estimated: false },
    payload: {},
    relatedEntities: [],
    ...overrides,
  };
}

describe("impact engine (Phase 6.5)", () => {
  let dataDir: string;
  let trip: Trip;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-impact-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    const runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(fixture),
    );
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { trip: Trip } };
    trip = created.data.trip;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("USER_LATE puts today's trailing items at risk but never the reservation-protected ones", () => {
    const protectedItem = trip.items[0];
    const withReservation: Trip = {
      ...trip,
      reservations: [reservation({ id: "r-dinner", type: "restaurant", title: "晚餐预订", startAt: "2030-05-01T18:30:00+08:00", linkedItemId: protectedItem.id })],
    };
    const impact = analyzeEventImpact(event({
      type: "USER_LATE", occurredAt: "2030-05-01T03:00:00Z", payload: { minutes: 45 },
    }), withReservation);
    expect(impact.timeDeltaMinutes).toBe(45);
    expect(impact.atRiskItemIds.length).toBeGreaterThan(0);
    expect(impact.atRiskItemIds).not.toContain(protectedItem.id);
    expect(impact.options.some((option) => option.strategy === "skip")).toBe(true);
  });

  it("HEAVY_RAIN flags outdoor items inside the window and offers an indoor swap", () => {
    const impact = analyzeEventImpact(event({
      type: "HEAVY_RAIN",
      occurredAt: "2030-05-01T06:00:00Z",
      effectiveFrom: "2030-05-01T14:00:00+08:00",
      effectiveUntil: "2030-05-01T18:00:00+08:00",
    }), trip);
    expect(impact.recommendedStrategy).toBe("indoorSwap");
    expect(impact.options.some((option) => option.strategy === "indoorSwap")).toBe(true);
  });

  it("FLIGHT_DELAYED quantifies the shift and protects hotel check-in", () => {
    const withFlight: Trip = {
      ...trip,
      reservations: [
        reservation({ id: "r-flight", type: "flight", title: "CA1468 桂林→重庆", startAt: "2030-05-01T00:30:00Z", endAt: "2030-05-01T02:45:00Z" }),
        reservation({ id: "r-hotel", type: "hotel", title: "解放碑威斯汀", startAt: "2030-05-01T07:00:00Z", endAt: "2030-05-02T04:00:00Z" }),
      ],
    };
    const impact = analyzeEventImpact(event({
      type: "FLIGHT_DELAYED", occurredAt: "2030-05-01T02:00:00Z",
      payload: { delayMinutes: 90 }, relatedEntities: [{ kind: "reservation", id: "r-flight" }],
    }), withFlight);
    expect(impact.timeDeltaMinutes).toBe(90);
    expect(impact.severity).toBe("critical");
    expect(impact.affectedEntities.some((entity) => entity.id === "r-hotel" && entity.relation.includes("保留"))).toBe(true);
    expect(impact.recommendedStrategy).toBe("shift");
  });

  it("POI_CLOSED marks items impossible when no reopening is known", () => {
    const item = trip.items[0];
    const impact = analyzeEventImpact(event({
      type: "POI_CLOSED", occurredAt: "2030-05-01T00:00:00Z",
      payload: { placeId: item.placeId },
    }), trip);
    expect(impact.impossibleItemIds).toContain(item.id);
    expect(impact.recommendedStrategy).toBe("replace");
  });

  it("POI_CLOSED without a placeId reports an unknown instead of guessing", () => {
    const impact = analyzeEventImpact(event({
      type: "POI_CLOSED", occurredAt: "2030-05-01T00:00:00Z",
    }), trip);
    expect(impact.unknowns.some((entry) => entry.includes("placeId"))).toBe(true);
    expect(impact.atRiskItemIds).toHaveLength(0);
    expect(impact.impossibleItemIds).toHaveLength(0);
  });

  it("RESERVATION_CANCELLED releases the linked item for re-planning", () => {
    const linked = trip.items[1];
    const impact = analyzeEventImpact(event({
      type: "RESERVATION_CANCELLED", occurredAt: "2030-05-01T00:00:00Z",
      relatedEntities: [{ kind: "reservation", id: "r-table" }],
    }), {
      ...trip,
      reservations: [reservation({ id: "r-table", type: "restaurant", title: "珮姐老火锅", startAt: "2030-05-01T10:30:00Z", linkedItemId: linked.id })],
    });
    expect(impact.recoverableItemIds).toContain(linked.id);
    expect(impact.recommendedStrategy).toBe("release");
  });

  it("resolves an event by id through the runtime command without recording it", async () => {
    const runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture),
    );
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { tripId: string; revision: number } };

    const recorded = await runtime.execute("record-travel-event", {
      tripId: created.data.tripId, expectedTripRevision: created.data.revision,
      event: { type: "USER_LATE", payload: { minutes: 30 }, summary: "晚点30分钟" },
    }) as { data: { event: { id: string } } };

    const analyzed = await runtime.execute("analyze-event-impact", {
      tripId: created.data.tripId, eventId: recorded.data.event.id,
    }) as { ok: boolean; data: { impact: { eventType: string; timeDeltaMinutes: number } } };
    expect(analyzed.ok).toBe(true);
    expect(analyzed.data.impact.eventType).toBe("USER_LATE");
    expect(analyzed.data.impact.timeDeltaMinutes).toBe(30);
  });

  it("computes in under 100ms per call", () => {
    const e = event({ type: "USER_LATE", occurredAt: "2030-05-01T03:00:00Z", payload: { minutes: 45 } });
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) analyzeEventImpact(e, trip);
    expect((performance.now() - started) / 20).toBeLessThan(100);
  });
});
