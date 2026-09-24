import { describe, expect, it } from "vitest";
import { chongqingTrip } from "@/data/demo/chongqing";
import { validateTrip } from "@/schemas/trip";
import { travelActionSchema, travelActionListSchema } from "@/services/ai/actions/schemas";

describe("trip schema", () => {
  it("accepts the Chongqing demo trip", () => {
    const result = validateTrip(chongqingTrip);
    expect(result.success).toBe(true);
  });

  it("rejects an item that points at an unknown place", () => {
    const broken = structuredClone(chongqingTrip);
    broken.items[0]!.placeId = "does-not-exist";
    const result = validateTrip(broken);
    expect(result.success).toBe(false);
  });
});

describe("travel action schema", () => {
  it("accepts REDUCE_BUDGET", () => {
    const parsed = travelActionSchema.safeParse({
      type: "REDUCE_BUDGET",
      payload: { amount: 300 },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts Phase 3 actions like RAIN_PLAN, DELAY_DAY, SKIP_NEXT", () => {
    const rain = travelActionSchema.safeParse({
      type: "RAIN_PLAN",
      payload: { dayId: "day-1", preferIndoor: true },
    });
    expect(rain.success).toBe(true);

    const delay = travelActionSchema.safeParse({
      type: "DELAY_DAY",
      payload: { dayId: "day-1", minutes: 60 },
    });
    expect(delay.success).toBe(true);

    const skip = travelActionSchema.safeParse({
      type: "SKIP_NEXT",
      payload: { dayId: "day-1" },
    });
    expect(skip.success).toBe(true);

    const budget = travelActionSchema.safeParse({
      type: "REDUCE_TODAY_BUDGET",
      payload: { dayId: "day-1", targetSaveAmount: 100 },
    });
    expect(budget.success).toBe(true);
  });

  it("rejects unknown action types", () => {
    const parsed = travelActionListSchema.safeParse({
      actions: [{ type: "HACK_THE_PLANET", payload: {} }],
    });
    expect(parsed.success).toBe(false);
  });
});
