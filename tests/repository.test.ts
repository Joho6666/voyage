import { describe, expect, it } from "vitest";
import { MemoryTripRepository } from "@/services/trips/repository";
import { chongqingTrip } from "@/data/demo/chongqing";

describe("MemoryTripRepository", () => {
  it("lists the seeded Chongqing trip", async () => {
    const repo = new MemoryTripRepository();
    const list = await repo.list();
    expect(list.some((t) => t.id === chongqingTrip.id)).toBe(true);
  });

  it("round-trips a save/get", async () => {
    const repo = new MemoryTripRepository();
    const clone = structuredClone(chongqingTrip);
    clone.title = "重庆夜色改版";
    await repo.save(clone);
    const loaded = await repo.get(clone.id);
    expect(loaded?.title).toBe("重庆夜色改版");
  });
});
