import { beforeEach, describe, expect, it } from "vitest";
import { usePlanningStore } from "@/store/planning-store";

describe("planning session pointer store", () => {
  beforeEach(() => {
    usePlanningStore.getState().clearSession();
    window.localStorage.removeItem("voyage-planning");
  });

  it("records a resumable pointer with destination and timestamp", () => {
    usePlanningStore.getState().setSession({ sessionId: "planning_test_1", destination: "南京" });
    const state = usePlanningStore.getState();
    expect(state.sessionId).toBe("planning_test_1");
    expect(state.destination).toBe("南京");
    expect(state.updatedAt).toBeTruthy();
  });

  it("survives a page refresh through localStorage and clears on demand", () => {
    usePlanningStore.getState().setSession({ sessionId: "planning_test_2", destination: "重庆" });
    expect(window.localStorage.getItem("voyage-planning")).toContain("planning_test_2");

    usePlanningStore.getState().clearSession();
    expect(usePlanningStore.getState().sessionId).toBeNull();
    expect(usePlanningStore.getState().destination).toBe("");
    expect(usePlanningStore.getState().updatedAt).toBeNull();
    expect(window.localStorage.getItem("voyage-planning")).not.toContain("planning_test_2");
  });
});
