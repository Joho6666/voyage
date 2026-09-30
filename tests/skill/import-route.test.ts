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

function makePlace(id: string, name: string, category: Place["category"] = "attraction"): Place {
  return {
    id,
    name,
    category,
    lat: 29.56,
    lng: 106.57,
    rating: 4.8,
    reviewCount: 100,
    image: "",
    priceLevel: 1,
    address: `${name}地址`,
    openingStatus: "open",
    stayMinutes: 60,
    description: "",
    tags: ["高德真实POI"],
    district: "渝中区",
    source: "amap",
    sourceId: id.replace(/^amap-/, ""),
    provenance: { source: "amap", estimated: false },
  };
}

describe("import-route command", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-import-route-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider not needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("spreads places into days, creates check-in tasks with linkedItemId, and computes routes", async () => {
    const p1 = makePlace("amap-p1", "洪崖洞民俗风貌区");
    const p2 = makePlace("amap-p2", "解放碑步行街");
    const p3 = makePlace("amap-p3", "李子坝观景台");

    const envelope = await runtime.importRoute({
      tripId: chongqingTrip.id,
      assignments: [
        { dayId: "day-1", places: [p1, p2] },
        { dayId: "day-2", places: [p3] },
      ],
      createTasks: true,
      expectedTripRevision: 1,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number; importedCount: number } };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.importedCount).toBe(3);
    expect(envelope.data.revision).toBe(2);

    const trip = envelope.data.trip;
    // Check items were added in order
    const day1Items = trip.items.filter((i) => i.dayId === "day-1" && (i.placeId === "amap-p1" || i.placeId === "amap-p2"));
    expect(day1Items).toHaveLength(2);
    expect(day1Items[0].placeId).toBe("amap-p1");
    expect(day1Items[1].placeId).toBe("amap-p2");

    // Check tasks were created and linked to items
    const tasks = trip.tasks.filter((t) => t.placeId === "amap-p1" || t.placeId === "amap-p2" || t.placeId === "amap-p3");
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(task.group).toBe("day");
      expect(task.status).toBe("todo");
      expect(task.checkin).toBe(true);
      expect(task.linkedItemId).toBeDefined();
      const matchingItem = trip.items.find((i) => i.id === task.linkedItemId);
      expect(matchingItem).toBeDefined();
      expect(matchingItem?.placeId).toBe(task.placeId);
    }

    // Verify persistence
    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.revision).toBe(2);
    expect(stored?.trip.items.some((i) => i.placeId === "amap-p1")).toBe(true);
  });

  it("rejects places without valid provenance", async () => {
    const unverified = makePlace("fake-1", "自制地点");
    delete (unverified as unknown as Record<string, unknown>).provenance;
    delete (unverified as unknown as Record<string, unknown>).source;

    await expect(runtime.importRoute({
      tripId: chongqingTrip.id,
      assignments: [{ dayId: "day-1", places: [unverified] }],
      expectedTripRevision: 1,
    })).rejects.toMatchObject({ code: "PLACE_SOURCE_UNVERIFIED" });
  });

  it("is idempotent: adding already-planned places skips duplicates and preserves revision", async () => {
    const p1 = makePlace("amap-p1", "洪崖洞民俗风貌区");
    await runtime.importRoute({
      tripId: chongqingTrip.id,
      assignments: [{ dayId: "day-1", places: [p1] }],
      expectedTripRevision: 1,
    });

    const second = await runtime.importRoute({
      tripId: chongqingTrip.id,
      assignments: [{ dayId: "day-1", places: [p1] }],
      expectedTripRevision: 2,
    }) as { data: { revision: number; importedCount?: number } };

    expect(second.data.revision).toBe(2);
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(2);
  });
});

describe("check-in linkage & set-task-status", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-checkin-linkage-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider not needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("setItemStatus automatically completes linked checkin tasks, and un-completes symmetrically", async () => {
    // Import a place with checkin task
    const p = makePlace("amap-p1", "洪崖洞民俗风貌区");
    const imported = await runtime.importRoute({
      tripId: chongqingTrip.id,
      assignments: [{ dayId: "day-1", places: [p] }],
      createTasks: true,
      expectedTripRevision: 1,
    }) as { data: { trip: typeof chongqingTrip; revision: number } };

    const item = imported.data.trip.items.find((i) => i.placeId === "amap-p1");
    expect(item).toBeDefined();

    // Check item off via setItemStatus
    const checked = await runtime.setItemStatus({
      tripId: chongqingTrip.id,
      itemId: item!.id,
      status: "done",
      expectedTripRevision: imported.data.revision,
    }) as { data: { trip: typeof chongqingTrip; revision: number } };

    const linkedTask = checked.data.trip.tasks.find((t) => t.linkedItemId === item!.id);
    expect(linkedTask).toBeDefined();
    expect(linkedTask?.status).toBe("done");

    // Symmetrically toggle back to planned -> task reverts to todo
    const unchecked = await runtime.setItemStatus({
      tripId: chongqingTrip.id,
      itemId: item!.id,
      status: "planned",
      expectedTripRevision: checked.data.revision,
    }) as { data: { trip: typeof chongqingTrip; revision: number } };

    const revertedTask = unchecked.data.trip.tasks.find((t) => t.linkedItemId === item!.id);
    expect(revertedTask?.status).toBe("todo");
  });

  it("setTaskStatus persists task updates with revision locking", async () => {
    // Demo trip has tasks like tk-1
    const stored = (await repository.getTrip(chongqingTrip.id))!;
    const task = stored.trip.tasks[0];
    expect(task).toBeDefined();

    const updated = await runtime.setTaskStatus({
      tripId: chongqingTrip.id,
      taskId: task.id,
      status: "done",
      expectedTripRevision: stored.revision,
    }) as { data: { trip: typeof chongqingTrip; revision: number } };

    expect(updated.data.revision).toBe(2);
    expect(updated.data.trip.tasks.find((t) => t.id === task.id)?.status).toBe("done");

    const reloaded = await repository.getTrip(chongqingTrip.id);
    expect(reloaded?.trip.tasks.find((t) => t.id === task.id)?.status).toBe("done");
  });
});
