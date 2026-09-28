// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip } from "@/data/demo/chongqing";
import type { Place } from "@/types/travel";

let dataDir: string;
let repository: JsonSkillRepository;
let runtime: VoyageSkillRuntime;

function providerPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "amap-test-123",
    name: "测试地点",
    category: "attraction",
    lat: 29.5628,
    lng: 106.5786,
    rating: 4.5,
    reviewCount: 10,
    image: "",
    priceLevel: 1,
    address: "测试地址",
    openingStatus: "unknown",
    stayMinutes: 60,
    description: "",
    tags: ["高德真实POI"],
    district: "渝中区",
    source: "amap",
    sourceId: "test-123",
    provenance: { source: "amap", estimated: false },
    ...overrides,
  };
}

describe("add-place-item runtime command", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-add-place-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider must not be needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("appends a provenance-verified place, recomputes the day, and persists", async () => {
    const envelope = await runtime.addPlaceItem({
      tripId: chongqingTrip.id,
      dayId: "day-1",
      place: providerPlace(),
      expectedTripRevision: 1,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number; tripHash: string } };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.revision).toBe(2);
    const added = envelope.data.trip.items.filter((item) => item.dayId === "day-1" && item.placeId === "amap-test-123");
    expect(added).toHaveLength(1);
    expect(envelope.data.trip.places.some((place) => place.id === "amap-test-123")).toBe(true);

    // The persisted file must contain it too — the old client-only path lost
    // the addition on reload.
    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.trip.items.some((item) => item.placeId === "amap-test-123")).toBe(true);
    expect(stored?.revision).toBe(2);
  });

  it("rejects a place without provider provenance", async () => {
    await expect(runtime.addPlaceItem({
      tripId: chongqingTrip.id,
      dayId: "day-1",
      place: providerPlace({ source: undefined, sourceId: undefined, provenance: undefined }),
      expectedTripRevision: 1,
    })).rejects.toMatchObject({ code: "PLACE_SOURCE_UNVERIFIED" });

    // Nothing was written.
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(1);
  });

  it("enforces the revision lock and rejects unknown days", async () => {
    await expect(runtime.addPlaceItem({
      tripId: chongqingTrip.id,
      dayId: "day-1",
      place: providerPlace(),
      expectedTripRevision: 9,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    await expect(runtime.addPlaceItem({
      tripId: chongqingTrip.id,
      dayId: "day-does-not-exist",
      place: providerPlace(),
      expectedTripRevision: 1,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not duplicate a place that is already planned that day", async () => {
    await runtime.addPlaceItem({
      tripId: chongqingTrip.id,
      dayId: "day-1",
      place: providerPlace(),
      expectedTripRevision: 1,
    });
    const second = await runtime.addPlaceItem({
      tripId: chongqingTrip.id,
      dayId: "day-1",
      place: providerPlace(),
      expectedTripRevision: 2,
    }) as { data: { trip: typeof chongqingTrip; revision: number } };
    expect(second.data.trip.items.filter((item) => item.placeId === "amap-test-123" && item.dayId === "day-1")).toHaveLength(1);
  });
});
