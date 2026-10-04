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

describe("remove-item runtime command", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-remove-item-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider must not be needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("removes the stop, cascades its check-in task, and persists", async () => {
    const envelope = await runtime.removeItem({
      tripId: chongqingTrip.id,
      itemId: "it-1-5", // p-hongyadong, linked check-in task tk-7
      expectedTripRevision: 1,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number } };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.revision).toBe(2);
    expect(envelope.data.trip.items.some((item) => item.id === "it-1-5")).toBe(false);
    expect(envelope.data.trip.tasks.some((task) => task.id === "tk-7")).toBe(false);
    // A plain task that merely shares the place survives removal.
    expect(envelope.data.trip.tasks.some((task) => task.id === "tk-6")).toBe(true);

    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.trip.items.some((item) => item.id === "it-1-5")).toBe(false);
    expect(stored?.trip.tasks.some((task) => task.id === "tk-7")).toBe(false);
    expect(stored?.revision).toBe(2);
  });

  it("keeps day-1 timing contiguous after the removal", async () => {
    const envelope = await runtime.removeItem({
      tripId: chongqingTrip.id,
      itemId: "it-1-2",
      expectedTripRevision: 1,
    }) as { data: { trip: typeof chongqingTrip } };

    const day1 = envelope.data.trip.items.filter((item) => item.dayId === "day-1").sort((a, b) => a.order - b.order);
    expect(day1.map((item) => item.id)).toEqual(["it-1-1", "it-1-3", "it-1-4", "it-1-5", "it-1-6"]);
    expect(day1[0].startTime).toBe("09:30");
  });

  it("rejects unknown items and revision conflicts without writing", async () => {
    await expect(runtime.removeItem({ tripId: chongqingTrip.id, itemId: "no-such-item", expectedTripRevision: 1 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(runtime.removeItem({ tripId: chongqingTrip.id, itemId: "it-1-1", expectedTripRevision: 9 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await repository.getTrip(chongqingTrip.id))?.revision).toBe(1);
  });
});
