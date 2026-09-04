import { describe, expect, it } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import { executeActions } from "@/services/ai/actions/executor";
import { computeTripChangeSet } from "@/services/ai/diff";

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

  it("executes DELAY_DAY by pushing back start times", () => {
    const firstItem = chongqingTrip.items.find((i) => i.dayId === "day-1");
    expect(firstItem).toBeTruthy();
    const oldTime = firstItem!.startTime;
    const result = executeActions(chongqingTrip, [
      { type: "DELAY_DAY", payload: { dayId: "day-1", minutes: 60 } },
    ]);
    expect(result.applied).toHaveLength(1);
    const updated = result.trip.items.find((i) => i.id === firstItem!.id);
    expect(updated?.startTime).not.toBe(oldTime);
  });

  it("executes REDUCE_TODAY_WALKING by swapping long walks to transit", () => {
    const result = executeActions(chongqingTrip, [
      { type: "REDUCE_TODAY_WALKING", payload: { dayId: "day-1", maxWalkMeters: 500 } },
    ]);
    expect(result.applied).toHaveLength(1);
    const day1WalkSegments = result.trip.segments.filter(
      (s) => s.dayId === "day-1" && s.mode === "walk",
    );
    // All walks should now be under or equal to threshold or switched to transit
    day1WalkSegments.forEach((s) => {
      expect(s.distanceMeters || s.meters).toBeLessThanOrEqual(500);
    });
  });

  it("executes RAIN_PLAN on a day", () => {
    const result = executeActions(chongqingTrip, [
      { type: "RAIN_PLAN", payload: { dayId: "day-2" } },
    ]);
    expect(result.applied).toHaveLength(1);
  });

  it("computes accurate TripChangeSet diff metrics", () => {
    const result = executeActions(chongqingTrip, [
      { type: "REDUCE_TODAY_WALKING", payload: { dayId: "day-1", maxWalkMeters: 400 } },
    ]);
    const changeSet = computeTripChangeSet(chongqingTrip, result.trip, result.applied);
    expect(changeSet.metrics).toBeDefined();
    expect(changeSet.metrics.walkDistanceAfterMeters).toBeLessThanOrEqual(
      changeSet.metrics.walkDistanceBeforeMeters,
    );
    expect(changeSet.summary).toBeTruthy();
  });
});
