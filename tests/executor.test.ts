import { describe, expect, it } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import { executeActions } from "@/services/ai/actions/executor";

describe("action executor", () => {
  it("removes an itinerary item and recomputes the day", () => {
    const target = chongqingTrip.items.find((i) => i.placeId === "p-ciqikou");
    expect(target).toBeTruthy();
    const result = executeActions(chongqingTrip, [
      { type: "REMOVE_ITEM", payload: { itemId: target!.id } },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.trip.items.some((i) => i.placeId === "p-ciqikou")).toBe(false);
    expect(result.trip.segments.every((s) => s.fromItemId !== target!.id)).toBe(true);
  });

  it("reduces estimated spend by the requested amount", () => {
    const before = chongqingTrip.estimatedSpend;
    const result = executeActions(chongqingTrip, [
      { type: "REDUCE_BUDGET", payload: { amount: 300 } },
    ]);
    expect(result.trip.estimatedSpend).toBe(Math.max(0, before - 300));
  });

  it("rejects ADD_ITEM for an unknown place", () => {
    const result = executeActions(chongqingTrip, [
      { type: "ADD_ITEM", payload: { placeId: "nope", dayId: "day-1" } },
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/place/);
  });

  it("moves an item to another day", () => {
    const item = chongqingTrip.items.find((i) => i.dayId === "day-1");
    expect(item).toBeTruthy();
    const result = executeActions(chongqingTrip, [
      { type: "MOVE_ITEM", payload: { itemId: item!.id, toDayId: "day-2" } },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.trip.items.find((i) => i.id === item!.id)?.dayId).toBe("day-2");
  });
});
