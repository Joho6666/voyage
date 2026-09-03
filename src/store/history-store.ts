import { create } from "zustand";
import type { Trip } from "@/types/travel";

const MAX_HISTORY = 10;

interface HistoryState {
  past: Trip[];
  future: Trip[];
  lastSnapshot: Trip | null;
  push: (snapshot: Trip) => void;
  undo: (current: Trip) => Trip | null;
  redo: (current: Trip) => Trip | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  reset: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  lastSnapshot: null,
  push: (snapshot) =>
    set((state) => ({
      past: [...state.past, structuredClone(snapshot)].slice(-MAX_HISTORY),
      future: [],
      lastSnapshot: structuredClone(snapshot),
    })),
  undo: (current) => {
    const { past, future } = get();
    if (!past.length) return null;
    const previous = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [structuredClone(current), ...future].slice(0, MAX_HISTORY),
    });
    return structuredClone(previous);
  },
  redo: (current) => {
    const { past, future } = get();
    if (!future.length) return null;
    const next = future[0];
    set({
      past: [...past, structuredClone(current)].slice(-MAX_HISTORY),
      future: future.slice(1),
    });
    return structuredClone(next);
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  reset: () => set({ past: [], future: [], lastSnapshot: null }),
}));
