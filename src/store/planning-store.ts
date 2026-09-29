import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The planning session itself lives on the server (`.voyage/guests/<id>/
 * planning-sessions/`); only the resumable pointer is kept here. Losing it is
 * what made a page refresh drop the whole conversation, even though the
 * server-side session and its GET endpoint were always intact.
 */
interface PlanningState {
  sessionId: string | null;
  destination: string;
  updatedAt: string | null;
  setSession: (session: { sessionId: string; destination?: string }) => void;
  clearSession: () => void;
}

export const usePlanningStore = create<PlanningState>()(
  persist(
    (set) => ({
      sessionId: null,
      destination: "",
      updatedAt: null,
      setSession: ({ sessionId, destination }) =>
        set({ sessionId, destination: destination ?? "", updatedAt: new Date().toISOString() }),
      clearSession: () => set({ sessionId: null, destination: "", updatedAt: null }),
    }),
    { name: "voyage-planning" },
  ),
);
