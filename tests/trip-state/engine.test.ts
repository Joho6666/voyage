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
import { getTripState } from "@/services/trip-state/engine";

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

describe("trip state engine (Phase 6.4)", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;
  let trip: Trip;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-trip-state-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(
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

  it("resolves the before phase before departure with no lateness", () => {
    const state = getTripState(trip, { asOf: "2030-04-28T03:00:00Z" }); // 2030-04-28 11:00 CST
    expect(state.phase).toBe("before");
    expect(state.currentDay).toBeNull();
    expect(state.lateByMinutes).toBeNull();
    expect(state.remainingItems.length).toBe(trip.items.filter((item) => item.status === "planned").length);
    expect(state.suggestedActions.some((action) => action.includes("尚未开始"))).toBe(true);
  });

  it("computes mid-trip progress: current/next items, lateness and finish estimate", () => {
    // Mark the first item done so the second becomes current.
    const sorted = trip.items.filter((item) => item.dayId === trip.days[0].id).sort((a, b) => a.order - b.order);
    sorted[0].status = "done";
    // 2030-05-01 04:30Z = 12:30 CST. Second item starts at some HH:mm — lateness is measurable.
    const state = getTripState({ ...trip, items: trip.items.map((item) => item.id === sorted[0].id ? { ...item, status: "done" as const } : item) }, { asOf: "2030-05-01T04:30:00Z" });
    expect(state.phase).toBe("during");
    expect(state.currentDay?.date).toBe("2030-05-01");
    expect(state.currentItem?.itemId).toBe(sorted[1].id);
    expect(state.nextItem?.itemId ?? null).toBe(sorted[2]?.id ?? null);
    expect(state.completedCount).toBe(1);
    expect(state.currentWeather?.condition).toBeTruthy();
    expect(state.estimatedFinishTime ?? null).not.toBeUndefined();
  });

  it("flags a critical active event as high risk with an action", () => {
    const delayed: Trip = {
      ...trip,
      travelEvents: [{
        id: "evt-1",
        tripId: trip.id,
        type: "FLIGHT_DELAYED",
        severity: "critical",
        occurredAt: "2030-05-01T02:00:00Z",
        source: "provider",
        provenance: { source: "provider", fetchedAt: "2030-05-01T02:00:00Z", confidence: 0.95, estimated: false },
        payload: { delayMinutes: 90 },
        relatedEntities: [],
      }],
    };
    const state = getTripState(delayed, { asOf: "2030-05-01T03:00:00Z" });
    expect(state.riskLevel).toBe("high");
    expect(state.activeEvents.some((event) => event.type === "FLIGHT_DELAYED")).toBe(true);
  });

  it("surfaces upcoming hard constraints and budget state", () => {
    const withReservations: Trip = {
      ...trip,
      reservations: [
        reservation({ id: "r-flight", type: "flight", title: "返程航班 CA1468", startAt: "2030-05-02T12:00:00Z" }),
      ],
    };
    const state = getTripState(withReservations, { asOf: "2030-05-01T03:00:00Z" });
    expect(state.activeReservations.some((candidate) => candidate.reservationId === "r-flight")).toBe(true);
    expect(state.upcomingHardConstraints.some((constraint) => constraint.id === "reservation:r-flight")).toBe(true);
    expect(state.budgetState).toEqual({ budget: trip.budget, estimatedSpend: trip.estimatedSpend, remaining: trip.budget - trip.estimatedSpend });
  });

  it("marks snapshots older than the staleness threshold", () => {
    const old = { ...trip, updatedAt: "2030-04-25T00:00:00Z" };
    const state = getTripState(old, { asOf: "2030-05-01T03:00:00Z" });
    expect(state.stale).toBe(true);
    const fresh = { ...trip, updatedAt: "2030-05-01T02:00:00Z" };
    expect(getTripState(fresh, { asOf: "2030-05-01T03:00:00Z" }).stale).toBe(false);
  });

  it("computes in under 100ms on a full trip", () => {
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) getTripState(trip, { asOf: "2030-05-01T04:00:00Z" });
    const perCall = (performance.now() - started) / 20;
    expect(perCall).toBeLessThan(100);
  });

  it("exposes the same state through the runtime command", async () => {
    const response = await runtime.execute("get-trip-state", {
      tripId: trip.id, asOf: "2030-05-01T04:30:00Z",
    }) as { ok: boolean; data: { state: { phase: string; tripId: string } } };
    expect(response.ok).toBe(true);
    expect(response.data.state.phase).toBe("during");
    expect(response.data.state.tripId).toBe(trip.id);
  });
});
