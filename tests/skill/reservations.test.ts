// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { validateTrip } from "@/schemas/trip";

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

const FLIGHT = {
  type: "flight" as const,
  title: "桂林两江 → 重庆江北 CA1468",
  startAt: "2030-05-01T08:30:00+08:00",
  endAt: "2030-05-01T10:45:00+08:00",
  origin: "桂林两江国际机场",
  destination: "重庆江北国际机场",
  provider: "fliggy",
  confirmationCode: "PNR-ABC123",
  price: 620,
  status: "confirmed" as const,
  flexibility: "fixed" as const,
};

describe("reservation domain (Phase 6.1)", () => {
  let dataDir: string;
  let fixture: Fixture;
  let runtime: VoyageSkillRuntime;
  let tripId: string;
  let revision: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-reservations-"));
    fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(
      new JsonSkillRepository(dataDir),
      async () => new RealFixtureProvider(fixture),
    );
    const created = await runtime.createTrip({
      destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { data: { tripId: string; revision: number } };
    tripId = created.data.tripId;
    revision = created.data.revision;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("adds a confirmed flight reservation with runtime-owned id and provenance", async () => {
    const response = await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision, reservation: FLIGHT,
    }) as { ok: boolean; data: { reservation: { id: string; provenance: { source: string }; status: string }; revision: number } };

    expect(response.ok).toBe(true);
    const reservation = response.data.reservation;
    expect(reservation.id).toMatch(/^res_/);
    expect(reservation.provenance.source).toBe("user");
    expect(reservation.status).toBe("confirmed");

    const stored = await runtime.getTrip({ tripId }) as { data: { trip: Trip } };
    expect(stored.data.trip.reservations).toHaveLength(1);
    expect(validateTrip(stored.data.trip).success).toBe(true);
    expect(response.data.revision).toBeGreaterThan(revision);
  });

  it("rejects writes with a stale revision and never trusts caller ids", async () => {
    await expect(runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision + 5, reservation: FLIGHT,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    // The strict input schema rejects a caller-supplied id outright — ids are
    // runtime-generated, never client-asserted.
    await expect(runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision, reservation: { ...FLIGHT, id: "forged-id" },
    })).rejects.toThrow();
  });

  it("updates status through the patch path and preserves provenance source", async () => {
    const added = await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision, reservation: FLIGHT,
    }) as { data: { reservation: { id: string }; revision: number } };

    const updated = await runtime.execute("update-reservation", {
      tripId, expectedTripRevision: added.data.revision,
      reservationId: added.data.reservation.id,
      patch: { status: "cancelled" as const, notes: "改签至下午航班" },
    }) as { data: { reservation: { status: string; notes: string; provenance: { source: string } } } };

    expect(updated.data.reservation.status).toBe("cancelled");
    expect(updated.data.reservation.notes).toContain("改签");
    expect(updated.data.reservation.provenance.source).toBe("user");
  });

  it("removes a reservation and refuses unknown ids", async () => {
    const added = await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision, reservation: FLIGHT,
    }) as { data: { reservation: { id: string }; revision: number } };

    await expect(runtime.execute("remove-reservation", {
      tripId, expectedTripRevision: added.data.revision, reservationId: "res-nope",
    })).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });

    const removed = await runtime.execute("remove-reservation", {
      tripId, expectedTripRevision: added.data.revision, reservationId: added.data.reservation.id,
    }) as { data: { reservations: unknown[]; revision: number } };
    expect(removed.data.reservations).toHaveLength(0);

    // A second remove of the same id now fails closed.
    await expect(runtime.execute("remove-reservation", {
      tripId, expectedTripRevision: removed.data.revision, reservationId: added.data.reservation.id,
    })).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });
  });

  it("filters reservations by status and type on read", async () => {
    const added = await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: revision, reservation: FLIGHT,
    }) as { data: { revision: number } };

    await runtime.execute("add-reservation", {
      tripId, expectedTripRevision: added.data.revision,
      reservation: { ...FLIGHT, type: "hotel" as const, title: "解放碑威斯汀", startAt: "2030-05-01T15:00:00+08:00", endAt: "2030-05-03T12:00:00+08:00", status: "tentative" as const },
    });

    const flights = await runtime.execute("get-reservations", { tripId, type: "flight" }) as { data: { total: number } };
    const confirmed = await runtime.execute("get-reservations", { tripId, status: "confirmed" }) as { data: { total: number } };
    const all = await runtime.execute("get-reservations", { tripId }) as { data: { total: number; reservations: Array<{ type: string }> } };

    expect(flights.data.total).toBe(1);
    expect(confirmed.data.total).toBe(1);
    expect(all.data.total).toBe(2);
    expect(all.data.reservations.map((candidate) => candidate.type).sort()).toEqual(["flight", "hotel"]);
  });

  it("bulk-imports pasted reservations and dedupes by confirmation code", async () => {
    const first = await runtime.execute("import-reservations", {
      tripId, expectedTripRevision: revision,
      vendor: "meituan",
      reservations: [
        FLIGHT,
        { type: "restaurant", title: "珮姐老火锅 解放碑店", startAt: "2030-05-01T18:30:00+08:00", status: "confirmed", flexibility: "semiFlexible" },
      ],
    }) as { data: { imported: unknown[]; skipped: unknown[]; revision: number } };
    expect(first.data.imported).toHaveLength(2);
    expect(first.data.skipped).toHaveLength(0);

    // Re-importing the same confirmation code is a no-op (skipped, no revision bump).
    const second = await runtime.execute("import-reservations", {
      tripId, expectedTripRevision: first.data.revision, vendor: "meituan",
      reservations: [FLIGHT, { type: "restaurant", title: "珮姐老火锅 解放碑店", startAt: "2030-05-01T18:30:00+08:00", confirmationCode: "MEI-999" }],
    }) as { data: { imported: unknown[]; skipped: string[]; revision: number } };
    expect(second.data.imported).toHaveLength(1);
    expect(second.data.skipped).toHaveLength(1);
    expect(second.data.revision).toBeGreaterThan(first.data.revision);

    // Import provenance records the vendor, source stays "import".
    const all = await runtime.execute("get-reservations", { tripId }) as { data: { reservations: Array<{ provenance: { source: string; vendor?: string } }> } };
    const imported = all.data.reservations.filter((candidate) => candidate.provenance.source === "import");
    expect(imported.length).toBe(3);
    expect(imported.every((candidate) => candidate.provenance.vendor === "meituan")).toBe(true);
  });
});
