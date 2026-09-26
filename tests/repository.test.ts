import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryTripRepository } from "@/services/trips/repository";
import { chongqingTrip } from "@/data/demo/chongqing";

describe("MemoryTripRepository", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    delete process.env.VOYAGE_DEMO_MODE;
  });

  it("seeds the Chongqing fixture only in explicit demo mode", async () => {
    process.env.VOYAGE_DEMO_MODE = "true";
    const demoRepo = new MemoryTripRepository();
    const demoList = await demoRepo.list();
    expect(demoList.some((t) => t.id === chongqingTrip.id)).toBe(true);

    // Fabricated coordinates, prices, and operating status must not leak into
    // normal mode as if they were real data.
    delete process.env.VOYAGE_DEMO_MODE;
    const plainRepo = new MemoryTripRepository();
    const plainList = await plainRepo.list();
    expect(plainList.some((t) => t.id === chongqingTrip.id)).toBe(false);
  });

  it("round-trips a save/get", async () => {
    const repo = new MemoryTripRepository();
    const clone = structuredClone(chongqingTrip);
    clone.title = "重庆夜色改版";
    await repo.save(clone);
    const loaded = await repo.get(clone.id);
    expect(loaded?.title).toBe("重庆夜色改版");
  });

  it("restores guest trips from browser storage after a reload", async () => {
    const firstSession = new MemoryTripRepository();
    const clone = structuredClone(chongqingTrip);
    clone.id = "guest-trip";
    clone.title = "Guest 持久化旅行";
    await firstSession.save(clone);

    const nextSession = new MemoryTripRepository();
    const loaded = await nextSession.get(clone.id);

    expect(loaded?.title).toBe("Guest 持久化旅行");
  });

  it("keeps guest storage in sync after deletion", async () => {
    const firstSession = new MemoryTripRepository();
    const clone = structuredClone(chongqingTrip);
    clone.id = "guest-trip-to-delete";
    await firstSession.save(clone);
    await firstSession.delete(clone.id);

    const nextSession = new MemoryTripRepository();
    expect(await nextSession.get(clone.id)).toBeNull();
  });
});
