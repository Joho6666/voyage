// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip } from "@/data/demo/chongqing";

let dataDir: string;
let repository: JsonSkillRepository;
let runtime: VoyageSkillRuntime;

describe("set-item-status runtime command", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-item-status-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider must not be needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("marks an item done and persists the change", async () => {
    const envelope = await runtime.setItemStatus({
      tripId: chongqingTrip.id,
      itemId: "it-1-1",
      status: "done",
      expectedTripRevision: 1,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number } };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.revision).toBe(2);
    expect(envelope.data.trip.items.find((item) => item.id === "it-1-1")?.status).toBe("done");

    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.trip.items.find((item) => item.id === "it-1-1")?.status).toBe("done");
    expect(stored?.revision).toBe(2);
  });

  it("is idempotent for the same status: no write, no revision bump", async () => {
    await runtime.setItemStatus({ tripId: chongqingTrip.id, itemId: "it-1-1", status: "done", expectedTripRevision: 1 });
    const second = await runtime.setItemStatus({ tripId: chongqingTrip.id, itemId: "it-1-1", status: "done", expectedTripRevision: 2 }) as { data: { revision: number } };
    expect(second.data.revision).toBe(2);
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(2);
  });

  it("rejects unknown items and revision conflicts without writing", async () => {
    await expect(runtime.setItemStatus({ tripId: chongqingTrip.id, itemId: "no-such-item", status: "done", expectedTripRevision: 1 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(runtime.setItemStatus({ tripId: chongqingTrip.id, itemId: "it-1-1", status: "done", expectedTripRevision: 9 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(1);
  });

  it("reorder-day rejects a day that does not exist", async () => {
    await expect(runtime.reorderDay({
      tripId: chongqingTrip.id,
      dayId: "day-does-not-exist",
      orderedItemIds: ["it-1-2", "it-1-1"],
      expectedTripRevision: 1,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(1);
  });
});

describe("add-place runtime command (map marks)", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-add-place-mark-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider must not be needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const mark = () => ({
    id: "amap-mark-777",
    name: "标记咖啡店",
    category: "cafe" as const,
    lat: 29.55,
    lng: 106.57,
    rating: 4.4,
    reviewCount: 20,
    image: "",
    priceLevel: 1,
    address: "测试路 7 号",
    openingStatus: "unknown" as const,
    stayMinutes: 45,
    description: "",
    tags: [],
    district: "渝中区",
    source: "amap" as const,
    sourceId: "mark-777",
    provenance: { source: "amap" as const, estimated: false },
  });

  it("bookmarks a verified place without scheduling it, and persists", async () => {
    const envelope = await runtime.addPlace({
      tripId: chongqingTrip.id,
      place: mark(),
      expectedTripRevision: 1,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number } };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.trip.places.some((place) => place.id === "amap-mark-777")).toBe(true);
    // A mark is not a schedule entry.
    expect(envelope.data.trip.items.some((item) => item.placeId === "amap-mark-777")).toBe(false);

    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.trip.places.some((place) => place.id === "amap-mark-777")).toBe(true);
    expect(stored?.revision).toBe(2);
  });

  it("rejects unverified places and duplicate marks without a revision bump", async () => {
    await expect(runtime.addPlace({
      tripId: chongqingTrip.id,
      place: { ...mark(), source: undefined, sourceId: undefined, provenance: undefined },
      expectedTripRevision: 1,
    })).rejects.toMatchObject({ code: "PLACE_SOURCE_UNVERIFIED" });

    await runtime.addPlace({ tripId: chongqingTrip.id, place: mark(), expectedTripRevision: 1 });
    const second = await runtime.addPlace({ tripId: chongqingTrip.id, place: mark(), expectedTripRevision: 2 }) as { data: { revision: number } };
    expect(second.data.revision).toBe(2);
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(2);
  });
});

describe("restore-trip runtime command (undo/redo)", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-restore-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider must not be needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("restores a snapshot and persists it so undo survives a reload", async () => {
    // Mutate through a real command first, then restore the original snapshot.
    await runtime.setItemStatus({ tripId: chongqingTrip.id, itemId: "it-1-1", status: "done", expectedTripRevision: 1 });
    const changed = (await repository.getTrip(chongqingTrip.id))!.trip;
    expect(changed.items.find((item) => item.id === "it-1-1")?.status).toBe("done");

    const restored = await runtime.restoreTrip({
      tripId: chongqingTrip.id,
      trip: structuredClone(chongqingTrip),
      expectedTripRevision: 2,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number } };

    expect(restored.ok).toBe(true);
    expect(restored.data.trip.items.find((item) => item.id === "it-1-1")?.status).toBe("planned");

    // The undo is on disk, not just in the browser: a reload sees it.
    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.trip.items.find((item) => item.id === "it-1-1")?.status).toBe("planned");
    expect(stored?.revision).toBe(3);
  });

  it("refuses a stale snapshot and pins the trip id to the target record", async () => {
    const hijack = { ...structuredClone(chongqingTrip), id: "some-other-trip" };
    await expect(runtime.restoreTrip({ tripId: chongqingTrip.id, trip: hijack, expectedTripRevision: 9 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const ok = await runtime.restoreTrip({ tripId: chongqingTrip.id, trip: hijack, expectedTripRevision: 1 }) as { data: { trip: typeof chongqingTrip } };
    expect(ok.data.trip.id).toBe(chongqingTrip.id);
  });
});
