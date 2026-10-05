import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

import { toast } from "sonner";
import { hydrateTrip, resyncTrip, useTripStore } from "@/store/trip-store";
import { useHistoryStore } from "@/store/history-store";
import { chongqingTrip } from "@/data/demo/chongqing";

const fetchMock = vi.fn();

function envelope(payload: { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }) {
  return { json: async () => payload };
}

function resetStore(trip = structuredClone(chongqingTrip)) {
  useTripStore.setState({ trip, revision: 3, saving: false });
  useHistoryStore.getState().reset();
}

describe.sequential("trip store revision discipline", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bumps the revision when setTrip is called without one", () => {
    const next = structuredClone(chongqingTrip);
    useTripStore.getState().setTrip(next);
    expect(useTripStore.getState().revision).toBe(4);
  });

  it("applies reorder optimistically, then adopts the server trip", async () => {
    const day1 = chongqingTrip.days[0];
    const day1Items = chongqingTrip.items.filter((item) => item.dayId === day1.id).map((item) => item.id);
    const reversed = [...day1Items].reverse();
    const serverTrip = structuredClone(chongqingTrip);
    fetchMock.mockResolvedValueOnce(envelope({ ok: true, data: { trip: serverTrip, revision: 7 } }));

    useTripStore.getState().reorder(day1.id, reversed);
    // Optimistic: the client order is visible before the server answers.
    const optimistic = useTripStore.getState().trip.items.filter((item) => item.dayId === day1.id);
    expect(optimistic.map((item) => item.id)).toEqual(reversed);
    await vi.waitFor(() => {
      expect(useTripStore.getState().trip).toBe(serverTrip);
      expect(useTripStore.getState().revision).toBe(7);
    });
  });

  it("rolls back the snapshot and resyncs on REVISION_CONFLICT", async () => {
    const day1 = chongqingTrip.days[0];
    const day1Items = chongqingTrip.items.filter((item) => item.dayId === day1.id).map((item) => item.id);
    const resynced = structuredClone(chongqingTrip);
    resynced.title = "别处更新后的最新版本";
    fetchMock
      .mockResolvedValueOnce(envelope({ ok: false, error: { code: "REVISION_CONFLICT", message: "Trip revision does not match" } }))
      .mockResolvedValueOnce(envelope({ data: { trip: resynced, revision: 9 } }));

    useTripStore.getState().reorder(day1.id, [...day1Items].reverse());
    await vi.waitFor(() => {
      expect(useTripStore.getState().trip.title).toBe("别处更新后的最新版本");
      expect(useTripStore.getState().revision).toBe(9);
    });
    expect(toast.error).toHaveBeenCalledWith("行程已在别处更新，已同步最新版本，请重试");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rolls back and toasts on network failure", async () => {
    const day1 = chongqingTrip.days[0];
    const day1Items = chongqingTrip.items.filter((item) => item.dayId === day1.id).map((item) => item.id);
    const orderBefore = chongqingTrip.items.filter((item) => item.dayId === day1.id).map((item) => item.order);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    useTripStore.getState().reorder(day1.id, [...day1Items].reverse());
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    const rolledBack = useTripStore.getState().trip.items.filter((item) => item.dayId === day1.id).map((item) => item.order);
    expect(rolledBack).toEqual(orderBefore);
    expect(useTripStore.getState().trip).toEqual(chongqingTrip);
  });

  it("resyncTrip replaces the trip with the authoritative copy", async () => {
    const authoritative = structuredClone(chongqingTrip);
    authoritative.title = "服务器版本";
    fetchMock.mockResolvedValueOnce(envelope({ data: { trip: authoritative, revision: 12 } }));
    resyncTrip(chongqingTrip.id);
    await vi.waitFor(() => {
      expect(useTripStore.getState().trip.title).toBe("服务器版本");
      expect(useTripStore.getState().revision).toBe(12);
    });
  });

  it("hydrateTrip resets the undo stack when switching trips", () => {
    const otherTrip = structuredClone(chongqingTrip);
    otherTrip.id = "another-trip";
    useHistoryStore.getState().push(structuredClone(chongqingTrip));
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    hydrateTrip(otherTrip as Trip);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });
});
