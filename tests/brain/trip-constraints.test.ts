// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Reservation } from "@/schemas/reservation";
import type { Trip } from "@/types/travel";
import {
  buildTripConstraints,
  evaluateCandidateMove,
  evaluateDayConstraints,
  evaluateTripConstraints,
} from "@/services/brain/constraints";
import { chongqingTrip } from "@/data/demo/chongqing";

function tripWithReservations(reservations: Reservation[], overrides: Partial<Trip> = {}): Trip {
  const trip = structuredClone(chongqingTrip);
  trip.startDate = "2030-05-01";
  trip.endDate = "2030-05-02";
  trip.days = trip.days.slice(0, 2).map((day, index) => ({ ...day, date: index === 0 ? "2030-05-01" : "2030-05-02" }));
  return { ...trip, reservations, ...overrides };
}

function reservation(overrides: Partial<Reservation> & { id: string; type: Reservation["type"]; title: string; startAt: string }): Reservation {
  return {
    tripId: "trip-x",
    status: "confirmed",
    flexibility: "fixed",
    currency: "CNY",
    provenance: { source: "user", fetchedAt: "2030-04-01T00:00:00+08:00", estimated: false },
    ...overrides,
  } as Reservation;
}

describe("buildTripConstraints", () => {
  it("maps confirmed reservations to typed hard constraints and ignores cancelled ones", () => {
    const trip = tripWithReservations([
      reservation({ id: "r-flight", type: "flight", title: "CA1468", startAt: "2030-05-01T08:30:00+08:00" }),
      reservation({ id: "r-hotel", type: "hotel", title: "解放碑威斯汀", startAt: "2030-05-01T15:00:00+08:00", endAt: "2030-05-02T12:00:00+08:00" }),
      reservation({ id: "r-dead", type: "train", title: "已取消高铁", startAt: "2030-05-01T09:00:00+08:00", status: "cancelled" }),
      reservation({ id: "r-tent", type: "restaurant", title: "珮姐老火锅", startAt: "2030-05-01T18:30:00+08:00", status: "tentative" }),
    ]);
    const constraints = buildTripConstraints(trip);
    expect(constraints.map((constraint) => constraint.id)).toEqual(["reservation:r-flight", "reservation:r-hotel"]);
    expect(constraints[0].kind).toBe("flightDeparture");
    expect(constraints[1].kind).toBe("hotelCheckinWindow");
    expect(constraints[1].endMs).toBeGreaterThan(constraints[1].startMs);
  });
});

describe("evaluateTripConstraints", () => {
  it("scores a clean trip at 100 with zero violations", () => {
    const trip = tripWithReservations([
      reservation({ id: "r-flight", type: "flight", title: "CA1468", startAt: "2030-05-01T08:30:00+08:00" }),
    ]);
    const evaluation = evaluateTripConstraints(trip);
    expect(evaluation.hardViolations).toHaveLength(0);
    expect(evaluation.score).toBe(100);
    expect(evaluation.evidence.length).toBe(1);
  });

  it("flags a confirmed reservation outside the trip dates as an error", () => {
    const trip = tripWithReservations([
      reservation({ id: "r-flight", type: "flight", title: "回程航班", startAt: "2030-06-01T08:30:00+08:00" }),
    ]);
    const evaluation = evaluateTripConstraints(trip);
    expect(evaluation.hardViolations[0]?.severity).toBe("error");
    expect(evaluation.hardViolations[0]?.detail).toContain("不在行程日期");
    expect(evaluation.score).toBe(70);
  });

  it("flags overlapping confirmed transit reservations as impossible", () => {
    const trip = tripWithReservations([
      reservation({ id: "r-1", type: "flight", title: "航班A", startAt: "2030-05-01T09:00:00+08:00", endAt: "2030-05-01T11:00:00+08:00" }),
      reservation({ id: "r-2", type: "train", title: "高铁B", startAt: "2030-05-01T10:00:00+08:00", endAt: "2030-05-01T13:00:00+08:00" }),
    ]);
    const evaluation = evaluateTripConstraints(trip);
    expect(evaluation.hardViolations.some((violation) => violation.detail.includes("时间重叠"))).toBe(true);
  });

  it("treats tentative reservations as warnings, not constraints", () => {
    const trip = tripWithReservations([
      reservation({ id: "r-tent", type: "restaurant", title: "珮姐老火锅", startAt: "2030-05-01T18:30:00+08:00", status: "tentative" }),
    ]);
    const evaluation = evaluateTripConstraints(trip);
    expect(evaluation.hardViolations).toHaveLength(0);
    expect(evaluation.hardConstraints).toHaveLength(0);
    expect(evaluation.warnings.some((warning) => warning.includes("尚未确认"))).toBe(true);
    expect(evaluation.unresolvedConstraints.some((entry) => entry.includes("r-tent"))).toBe(true);
  });

  it("checks linked items against their reservation window", () => {
    const trip = tripWithReservations([
      reservation({
        id: "r-dinner", type: "restaurant", title: "晚餐预订",
        startAt: "2030-05-01T18:30:00+08:00", endAt: "2030-05-01T20:30:00+08:00",
        linkedItemId: tripWithReservations([]).items[0].id,
      }),
    ]);
    const evaluation = evaluateTripConstraints(trip);
    // The first item is a morning stop — nowhere near the 18:30 window.
    expect(evaluation.hardViolations.some((violation) => violation.detail.includes("超出预订时间窗"))).toBe(true);
  });
});

describe("evaluateDayConstraints", () => {
  it("scopes constraints to the requested day", () => {
    const trip = tripWithReservations([
      reservation({ id: "r-day1", type: "flight", title: "Day1 航班", startAt: "2030-05-01T08:30:00+08:00" }),
      reservation({ id: "r-day2", type: "train", title: "Day2 高铁", startAt: "2030-05-02T09:00:00+08:00" }),
    ]);
    const day1 = evaluateDayConstraints(trip, trip.days[0].id);
    const day2 = evaluateDayConstraints(trip, trip.days[1].id);
    expect(day1.hardConstraints.map((constraint) => constraint.reservationId)).toEqual(["r-day1"]);
    expect(day2.hardConstraints.map((constraint) => constraint.reservationId)).toEqual(["r-day2"]);
  });
});

describe("evaluateCandidateMove", () => {
  const trip = tripWithReservations([
    reservation({ id: "r-flight", type: "flight", title: "返程航班", startAt: "2030-05-02T20:00:00+08:00", endAt: "2030-05-02T22:00:00+08:00" }),
  ]);

  it("allows a move into free space", () => {
    const item = trip.items.find((candidate) => candidate.dayId === trip.days[0].id)!;
    const result = evaluateCandidateMove(trip, { itemId: item.id, toDayId: trip.days[1].id, toStartTime: "10:00" });
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects a move that overlaps a fixed confirmed reservation window", () => {
    const item = trip.items.find((candidate) => candidate.dayId === trip.days[0].id)!;
    const result = evaluateCandidateMove(trip, { itemId: item.id, toDayId: trip.days[1].id, toStartTime: "20:30" });
    expect(result.allowed).toBe(false);
    expect(result.violations.some((violation) => violation.includes("返程航班"))).toBe(true);
  });

  it("never moves a completed or current item", () => {
    const locked = structuredClone(trip);
    const first = locked.items.find((candidate) => candidate.dayId === locked.days[0].id)!;
    first.status = "done";
    const result = evaluateCandidateMove(locked, { itemId: first.id, toDayId: locked.days[1].id, toStartTime: "10:00" });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("不可移动");
  });

  it("rejects unknown items and unknown days", () => {
    expect(evaluateCandidateMove(trip, { itemId: "nope", toDayId: trip.days[0].id }).allowed).toBe(false);
    const item = trip.items[0];
    expect(evaluateCandidateMove(trip, { itemId: item.id, toDayId: "nope" }).allowed).toBe(false);
  });
});
