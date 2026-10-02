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

describe("remove-day runtime command", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-remove-day-"));
    repository = new JsonSkillRepository(dataDir);
    runtime = new VoyageSkillRuntime(repository, async () => { throw new Error("provider must not be needed"); });
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("removes a middle day, re-indexes the rest, and persists", async () => {
    const envelope = await runtime.removeDay({
      tripId: chongqingTrip.id,
      dayId: "day-2",
      expectedTripRevision: 1,
    }) as { ok: boolean; data: { trip: typeof chongqingTrip; revision: number } };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.revision).toBe(2);
    expect(envelope.data.trip.days.map((day) => day.id)).toEqual(["day-1", "day-3"]);
    expect(envelope.data.trip.days.map((day) => day.index)).toEqual([0, 1]);
    expect(envelope.data.trip.items.some((item) => item.dayId === "day-2")).toBe(false);
    // The deleted day's tasks (tk-8/tk-9) go with it; other days' survive.
    expect(envelope.data.trip.tasks.some((task) => task.id === "tk-8")).toBe(false);
    expect(envelope.data.trip.tasks.some((task) => task.id === "tk-9")).toBe(false);
    expect(envelope.data.trip.tasks.some((task) => task.id === "tk-5")).toBe(true);
    expect(envelope.data.trip.segments.some((segment) => segment.dayId === "day-2")).toBe(false);

    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.trip.days.map((day) => day.id)).toEqual(["day-1", "day-3"]);
    expect(stored?.revision).toBe(2);
  });

  it("recomputes the date span when the last day is removed", async () => {
    const envelope = await runtime.removeDay({
      tripId: chongqingTrip.id,
      dayId: "day-3",
      expectedTripRevision: 1,
    }) as { data: { trip: typeof chongqingTrip } };

    expect(envelope.data.trip.days.map((day) => day.id)).toEqual(["day-1", "day-2"]);
    expect(envelope.data.trip.startDate).toBe("2026-09-20");
    expect(envelope.data.trip.endDate).toBe("2026-09-21");
  });

  it("refuses the last remaining day, unknown days, and revision conflicts without writing", async () => {
    await runtime.removeDay({ tripId: chongqingTrip.id, dayId: "day-2", expectedTripRevision: 1 });
    await runtime.removeDay({ tripId: chongqingTrip.id, dayId: "day-3", expectedTripRevision: 2 });
    // Only day-1 remains: the last-day guard must fire.
    await expect(runtime.removeDay({ tripId: chongqingTrip.id, dayId: "day-1", expectedTripRevision: 3 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await repository.getTrip(chongqingTrip.id))?.trip.days.length).toBe(1);

    await expect(runtime.removeDay({ tripId: chongqingTrip.id, dayId: "no-such-day", expectedTripRevision: 3 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(runtime.removeDay({ tripId: chongqingTrip.id, dayId: "day-1", expectedTripRevision: 9 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
});
