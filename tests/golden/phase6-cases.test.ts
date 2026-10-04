// @vitest-environment node
// Phase 6 golden cases — the fifteen scenarios from docs/PHASE6_PLAN.md §10.
// Several are already locked by dedicated suites; this file pins the ones that
// need the full Event → State → Impact → Replan → Apply chain in one place:
//   Case 1  flight delayed 90min, hotel protected, Day 1 replanned
//   Case 4  train departure is a fixed constraint the replan cannot cross
//   Case 6  walking overload → reduceWalking proposal
//   Case 14 provider failure → proposal still generated, clearly degraded
// Covered elsewhere:
//   Case 2  rain → RAIN_PLAN (tests/skill/event-providers, runtime.test)
//   Case 3  user late, reservation protected (tests/replan/event-replan)
//   Case 5  POI closed → replace (tests/impact/engine)
//   Case 7  reservation cancelled releases window (tests/impact/engine)
//   Case 8  unknown data → unknowns, never guesses (tests/impact/engine,
//           tests/brain/trip-constraints)
//   Case 9  rejected proposal leaves trip untouched (tests/golden-cases)
//   Case 10 two events, revision correctness (tests/replan/event-replan)
//   Case 11 proposalToken expiry (tests/skill/proposal-token PROPOSAL_EXPIRED)
//   Case 12 agent apply attempt fails (agent route hard-block + golden case 3)
//   Case 13 offline stale TripState flag (tests/trip-state/engine stale)
//   Case 15 concurrent replans conflict (tests/replan/event-replan)
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";
import type { Reservation } from "@/schemas/reservation";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { evaluateCandidateMove } from "@/services/brain/constraints";

vi.setConfig({ testTimeout: 60_000 });

interface Fixture {
  places: Array<{ id: string; name: string; category: string; lat: number; lng: number }>;
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  failRoutes = false;
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
    if (this.failRoutes) throw new Error("amap route failure");
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

describe("Phase 6 golden cases", () => {
  let dataDir: string;
  let fixture: Fixture;
  let provider: RealFixtureProvider;
  let runtime: VoyageSkillRuntime;
  let tripId: string;
  let revision: number;
  let trip: Trip;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-golden6-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    provider = new RealFixtureProvider(fixture);
    runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => provider,
    );
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { tripId: string; revision: number; trip: Trip } };
    tripId = created.data.tripId;
    revision = created.data.revision;
    trip = created.data.trip;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("Case 1: flight delayed 90min — hotel check-in protected, Day 1 replanned via proposal", async () => {
    // Day-1 morning arrival flight plus a confirmed hotel check-in on Day 1.
    const afterFlight = await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision,
      reservation: { type: "flight" as const, title: "CA1468 桂林→重庆", startAt: "2030-05-01T01:30:00Z", endAt: "2030-05-01T03:45:00Z", status: "confirmed" as const },
    }) as { data: { revision: number; reservation: { id: string } } };
    await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: afterFlight.data.revision,
      reservation: { type: "hotel" as const, title: "解放碑威斯汀", startAt: "2030-05-01T07:00:00Z", endAt: "2030-05-02T04:00:00Z", status: "confirmed" as const },
    }) as { data: { revision: number } };

    const recorded = await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision + 2,
      event: {
        type: "FLIGHT_DELAYED", source: "provider", severity: "critical", summary: "CA1468 延误 90 分钟",
        payload: { delayMinutes: 90 },
        relatedEntities: [{ kind: "reservation" as const, id: afterFlight.data.reservation.id }],
      },
    }) as { data: { event: { id: string }; revision: number } };

    const analyzed = await runtime.execute("analyze-event-impact", { tripId, eventId: recorded.data.event.id }) as {
      data: { impact: { timeDeltaMinutes: number; recommendedStrategy: string; affectedEntities: Array<{ id: string; relation: string }> } };
    };
    expect(analyzed.data.impact.timeDeltaMinutes).toBe(90);
    expect(analyzed.data.impact.recommendedStrategy).toBe("shift");
    // The hotel is surfaced as protected, never as droppable.
    expect(analyzed.data.impact.affectedEntities.some((entity) => entity.relation.includes("保留"))).toBe(true);

    const proposal = await runtime.execute("propose-event-replan", {
      tripId, eventId: recorded.data.event.id, strategy: "shift", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string; proposalToken: string; actions: Array<{ type: string; payload: Record<string, unknown> }> } };
    expect(proposal.data.proposalId).toEqual(expect.any(String));
    expect(proposal.data.actions.some((action) => action.type === "DELAY_DAY")).toBe(true);

    const applied = await runtime.execute("apply-change", {
      tripId, proposalId: proposal.data.proposalId, expectedTripRevision: recorded.data.revision,
      confirmed: true, proposalToken: proposal.data.proposalToken,
    }) as { data: { trip: Trip; revision: number } };
    expect(applied.data.revision).toBeGreaterThan(revision);
    // Both reservations survive the replan untouched.
    const final = await runtime.execute("get-reservations", { tripId }) as { data: { reservations: Array<{ status: string; type: string }> } };
    expect(final.data.reservations).toHaveLength(2);
    expect(final.data.reservations.every((candidate) => candidate.status === "confirmed")).toBe(true);
  });

  it("Case 4: train departure is a fixed constraint — moves into its window are rejected", async () => {
    const withTrain: Trip = {
      ...trip,
      reservations: [reservation({ id: "r-train", type: "train", title: "G318 返程高铁", startAt: "2030-05-02T12:00:00Z", endAt: "2030-05-02T14:30:00Z" })],
    };
    const item = withTrain.items.find((candidate) => candidate.dayId === withTrain.days[0].id)!;
    // 12:00Z = 20:00 CST on 2030-05-02: a 20:30 arrival overlaps the departure window.
    const blocked = evaluateCandidateMove(withTrain, { itemId: item.id, toDayId: withTrain.days[1].id, toStartTime: "20:30" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.violations.some((violation) => violation.includes("G318"))).toBe(true);
    // Earlier in the day it is fine.
    const ok = evaluateCandidateMove(withTrain, { itemId: item.id, toDayId: withTrain.days[1].id, toStartTime: "10:00" });
    expect(ok.allowed).toBe(true);
  });

  it("Case 6: walking overload → reduceWalking proposal through the event chain", async () => {
    const recorded = await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision,
      event: { type: "WALKING_OVERLOAD", effectiveFrom: "2030-05-01T00:00:00+08:00", summary: "今日步行超载" },
    }) as { data: { event: { id: string } } };

    const proposal = await runtime.execute("propose-event-replan", {
      tripId, eventId: recorded.data.event.id, strategy: "reduceWalking", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string | null; actions: Array<{ type: string }> } };
    expect(proposal.data.proposalId).toEqual(expect.any(String));
    expect(proposal.data.actions.some((action) => action.type === "REDUCE_TODAY_WALKING")).toBe(true);
  });

  it("Case 14: provider failure degrades gracefully — proposal still generated with estimated routes", async () => {
    provider.failRoutes = true;
    const recorded = await runtime.execute("record-travel-event", {
      tripId, expectedTripRevision: revision,
      event: { type: "USER_LATE", effectiveFrom: "2030-05-01T06:00:00Z", payload: { minutes: 45 } },
    }) as { data: { event: { id: string } } };

    const proposal = await runtime.execute("propose-event-replan", {
      tripId, eventId: recorded.data.event.id, strategy: "skip", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string | null }; warnings: string[] };
    expect(proposal.data.proposalId).toEqual(expect.any(String));
    expect(proposal.warnings.some((warning) => warning.toLowerCase().includes("haversine"))).toBe(true);

    // And the trip itself stays intact for the traveller.
    const stored = await runtime.execute("get-trip", { tripId }) as { data: { trip: Trip } };
    expect(stored.data.trip.items).toHaveLength(trip.items.length);
  });
});
