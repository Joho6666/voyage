// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Place[];
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: Place["category"]; limit: number }) {
    return this.fixture.places
      .filter((candidate) => !input.category || candidate.category === input.category)
      .slice(0, input.limit)
      .map((candidate) => ({ ...candidate, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

describe("get-today-context (Today Mode v2)", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-today-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(new JsonSkillRepository(dataDir), async () => new RealFixtureProvider(fixture));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function create() {
    const created = await runtime.createTrip({
      origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500,
      preferences: [], fallbackPolicy: "estimated",
    }) as any;
    return created.data;
  }

  it("computes current stop, next hop, transit, and remaining budget for the day", async () => {
    const data = await create();
    const context = await runtime.getTodayContext({ tripId: data.tripId, dayId: data.trip.days[0].id }) as any;
    expect(context.ok).toBe(true);
    const payload = context.data;
    expect(payload.dayId).toBe(data.trip.days[0].id);
    expect(payload.current).toBeTruthy();
    expect(payload.current.name).toBeTruthy();
    expect(payload.next).toBeTruthy();
    expect(payload.next.name).toBeTruthy();
    expect(payload.next.transit).toBeTruthy();
    expect(payload.next.transit.minutes).toBeGreaterThan(0);
    expect(payload.next.suggestedDeparture).toMatch(/^\d{2}:\d{2}$/);
    expect(payload.next.estimatedArrival).toMatch(/^\d{2}:\d{2}$/);
    expect(payload.remaining.places).toBeGreaterThan(0);
    expect(typeof payload.remaining.walkMeters).toBe("number");
    expect(Array.isArray(payload.suggestions)).toBe(true);
  });

  it("done stops are not treated as remaining", async () => {
    const data = await create();
    const tripId = data.tripId as string;
    const firstItem = data.trip.items.filter((item: any) => item.dayId === data.trip.days[0].id)[0];
    await runtime.setItemStatus({ tripId, itemId: firstItem.id, status: "done", expectedTripRevision: data.revision });

    const context = await runtime.getTodayContext({ tripId, dayId: data.trip.days[0].id }) as any;
    expect(context.data.current.itemId).not.toBe(firstItem.id);
    const before = (await runtime.getTrip({ tripId }) as any).data.trip;
    const done = before.items.find((item: any) => item.id === firstItem.id);
    expect(done.status).toBe("done");
    expect(done.dayId).toBe(firstItem.dayId);
  });

  it("detects a late schedule from asOf", async () => {
    const data = await create();
    const context = await runtime.getTodayContext({ tripId: data.tripId, dayId: data.trip.days[0].id, asOf: "2030-05-01T23:00" }) as any;
    expect(context.data.lateMinutes).not.toBeNull();
    expect(context.data.lateMinutes).toBeGreaterThan(30);
    expect(context.data.suggestions.some((suggestion: any) => suggestion.kind === "late")).toBe(true);
  });

  it("raises a rain suggestion when the day is rainy", async () => {
    const data = await create();
    const tripId = data.tripId as string;
    const stored = (await runtime.getTrip({ tripId }) as any).data;
    const trip = stored.trip;
    trip.days[0].weather = { tempC: 20, condition: "中雨", icon: "rain" };
    await runtime.restoreTrip({ tripId, trip, expectedTripRevision: stored.revision });

    const context = await runtime.getTodayContext({ tripId, dayId: trip.days[0].id }) as any;
    expect(context.data.suggestions.some((suggestion: any) => suggestion.kind === "rain")).toBe(true);
    expect(context.data.weather.icon).toBe("rain");
  });

  it("suggests a lower-walking plan when the remaining day is heavy", async () => {
    const data = await create();
    const tripId = data.tripId as string;
    const stored = (await runtime.getTrip({ tripId }) as any).data;
    const trip = stored.trip;
    const dayId = trip.days[0].id;
    const dayItems = trip.items.filter((item: any) => item.dayId === dayId).sort((a: any, b: any) => a.order - b.order);
    const lastItem = dayItems[dayItems.length - 1];
    const fromPlace = trip.places.find((place: any) => place.id === dayItems[0].placeId);
    trip.segments = trip.segments.filter((segment: any) => segment.dayId !== dayId);
    trip.segments.push({
      id: "seg-heavy", dayId, fromItemId: dayItems[0].id, toItemId: lastItem.id,
      fromPlaceId: fromPlace.id, toPlaceId: lastItem.placeId, mode: "walk",
      distanceMeters: 6000, durationMinutes: 75, meters: 6000, minutes: 75,
      label: "步行", provider: "amap", estimated: false, updatedAt: new Date().toISOString(),
    });
    await runtime.restoreTrip({ tripId, trip, expectedTripRevision: stored.revision });

    const context = await runtime.getTodayContext({ tripId, dayId }) as any;
    expect(context.data.remaining.walkMeters).toBeGreaterThanOrEqual(6000);
    expect(context.data.suggestions.some((suggestion: any) => suggestion.kind === "high_walking")).toBe(true);
  });

  it("never fabricates weather: unknown stays labeled unknown", async () => {
    const data = await create();
    const tripId = data.tripId as string;
    const stored = (await runtime.getTrip({ tripId }) as any).data;
    const trip = stored.trip;
    // The schema keeps weather required, so "unknown" is the explicit
    // unavailable provenance — never a made-up forecast.
    trip.days[0].weather = {
      tempC: 0, condition: "天气未知", icon: "overcast",
      provenance: { source: "unavailable", estimated: true, reason: "NO_FORECAST_FOR_DATE" },
    };
    await runtime.restoreTrip({ tripId, trip, expectedTripRevision: stored.revision });
    const context = await runtime.getTodayContext({ tripId, dayId: trip.days[0].id }) as any;
    expect(context.data.weather.condition).toBe("天气未知");
    expect(context.data.weather.provenance.source).toBe("unavailable");
    expect(context.data.suggestions.some((suggestion: any) => suggestion.kind === "rain")).toBe(false);
  });
});
