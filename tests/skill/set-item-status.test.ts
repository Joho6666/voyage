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
