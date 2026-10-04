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

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Array<{ id: string; name: string; category: string; lat: number; lng: number }>;
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  routeCalls = 0;
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
    this.routeCalls += 1;
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

const RAIN_EVENT = {
  type: "HEAVY_RAIN" as const,
  severity: "warning" as const,
  effectiveFrom: "2030-05-01T14:00:00+08:00",
  effectiveUntil: "2030-05-01T18:00:00+08:00",
  summary: "午后暴雨",
};

describe("event-driven replan (Phase 6.6)", () => {
  let dataDir: string;
  let fixture: Fixture;
  let provider: RealFixtureProvider;
  let runtime: VoyageSkillRuntime;
  let tripId: string;
  let revision: number;
  let trip: Trip;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-event-replan-"));
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

  it("heavy rain produces a RAIN_PLAN proposal through the standard pipeline", async () => {
    const proposal = await runtime.execute("propose-event-replan", {
      tripId, event: RAIN_EVENT, strategy: "indoorSwap", fallbackPolicy: "estimated",
    }) as { ok: boolean; data: { proposalId: string; proposalToken: string; strategy: string; eventType: string; changes: { summary: string }; actions: Array<{ type: string }> } };

    expect(proposal.ok).toBe(true);
    expect(proposal.data.proposalId).toEqual(expect.any(String));
    expect(proposal.data.proposalToken).toEqual(expect.any(String));
    expect(proposal.data.eventType).toBe("HEAVY_RAIN");
    expect(proposal.data.strategy).toBe("indoorSwap");
    expect(proposal.data.actions.some((action) => action.type === "RAIN_PLAN")).toBe(true);

    // Nothing applied until the user confirms.
    const stored = await runtime.getTrip({ tripId }) as { data: { trip: Trip; revision: number } };
    expect(stored.data.revision).toBe(revision);
  });

  it("USER_LATE with skip strategy removes a trailing planned item but never a reservation-linked one", async () => {
    const linkedItem = trip.items[0];
    await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision,
      reservation: {
        type: "restaurant" as const, title: "晚餐预订", startAt: "2030-05-01T10:30:00Z",
        status: "confirmed" as const, flexibility: "fixed" as const, linkedItemId: linkedItem.id,
      },
    });

    const proposal = await runtime.execute("propose-event-replan", {
      tripId, event: { type: "USER_LATE", effectiveFrom: "2030-05-01T06:00:00Z", payload: { minutes: 45 } }, strategy: "skip", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string | null; actions: Array<{ type: string; payload: Record<string, unknown> }> } };

    expect(proposal.data.proposalId).toEqual(expect.any(String));
    expect(proposal.data.actions.some((action) => action.type === "REMOVE_ITEM")).toBe(true);
    const removedId = proposal.data.actions.find((action) => action.type === "REMOVE_ITEM")?.payload.itemId;
    expect(removedId).not.toBe(linkedItem.id);
  });

  it("monitor strategy reports without a proposal", async () => {
    const response = await runtime.execute("propose-event-replan", {
      tripId, event: { type: "USER_AHEAD" }, strategy: "monitor", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string | null; note: string } };
    expect(response.data.proposalId).toBeNull();
    expect(response.data.note).toBeTruthy();
  });

  it("applying the proposal requires the full confirmation chain", async () => {
    const proposal = await runtime.execute("propose-event-replan", {
      tripId, event: RAIN_EVENT, strategy: "indoorSwap", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string; proposalToken: string; baseRevision: number } };

    await expect(runtime.execute("apply-change", {
      tripId, proposalId: proposal.data.proposalId, expectedTripRevision: revision, confirmed: true,
    })).rejects.toMatchObject({ code: "PROPOSAL_TOKEN_REQUIRED" });

    const applied = await runtime.execute("apply-change", {
      tripId, proposalId: proposal.data.proposalId, expectedTripRevision: revision,
      confirmed: true, proposalToken: proposal.data.proposalToken,
    }) as { data: { revision: number } };
    expect(applied.data.revision).toBeGreaterThan(revision);
  });

  it("concurrent replans: the second apply hits a revision conflict", async () => {
    const first = await runtime.execute("propose-event-replan", {
      tripId, event: RAIN_EVENT, strategy: "indoorSwap", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string; proposalToken: string } };
    const second = await runtime.execute("propose-event-replan", {
      tripId, event: { type: "USER_LATE", effectiveFrom: "2030-05-01T06:00:00Z", payload: { minutes: 45 } }, strategy: "skip", fallbackPolicy: "estimated",
    }) as { data: { proposalId: string; proposalToken: string; baseRevision: number } };

    await runtime.execute("apply-change", {
      tripId, proposalId: first.data.proposalId, expectedTripRevision: revision,
      confirmed: true, proposalToken: first.data.proposalToken,
    });

    // The second proposal was built on the same base revision; applying it now is stale.
    await expect(runtime.execute("apply-change", {
      tripId, proposalId: second.data.proposalId, expectedTripRevision: second.data.baseRevision,
      confirmed: true, proposalToken: second.data.proposalToken,
    })).rejects.toMatchObject({ code: expect.stringMatching(/REVISION_CONFLICT|PROPOSAL_STALE/) });
  });
});
