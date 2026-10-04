import { beforeEach, describe, expect, it } from "vitest";
import { useHistoryStore } from "@/store/history-store";
import type { Trip } from "@/types/travel";

function trip(id: string, title: string): Trip {
  return { id, title } as unknown as Trip;
}

describe("history store trip scoping", () => {
  beforeEach(() => {
    useHistoryStore.getState().reset();
  });

  it("refuses to undo a snapshot from another trip and drops the stale stack", () => {
    const store = useHistoryStore.getState();
    store.push(trip("trip-a", "A 的修改后"));
    expect(store.canUndo()).toBe(true);

    // The traveller switched to trip B; undoing there must not hand back A's
    // snapshot (restore-trip would write it into B's server record).
    expect(useHistoryStore.getState().undo(trip("trip-b", "B"))).toBeNull();
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it("still undoes within the same trip", () => {
    const store = useHistoryStore.getState();
    const snapshot = trip("trip-a", "A 修改前");
    store.push(snapshot);
    const previous = useHistoryStore.getState().undo(trip("trip-a", "A 修改后"));
    expect(previous?.id).toBe("trip-a");
  });

  it("redo also refuses cross-trip snapshots", () => {
    const store = useHistoryStore.getState();
    store.push(trip("trip-a", "A"));
    const undone = useHistoryStore.getState().undo(trip("trip-a", "A 修改后"));
    expect(undone).toBeTruthy();
    // Trip switch between undo and redo poisons the future stack.
    expect(useHistoryStore.getState().redo(trip("trip-b", "B"))).toBeNull();
    expect(useHistoryStore.getState().canRedo()).toBe(false);
  });
});
