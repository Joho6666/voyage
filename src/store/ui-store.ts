import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WorkspaceTab = "itinerary" | "explore" | "book" | "tasks";
export type MapFilter = "attraction" | "food" | "cafe" | "hotel" | "activity";
export type SheetSnap = "collapsed" | "half" | "full";

interface UiState {
  sidebarCollapsed: boolean;
  assistantOpen: boolean;
  commandOpen: boolean;
  selectedPlaceId: string | null;
  hoverPlaceId: string | null;
  /** null means "全部" — every day is shown. */
  activeDayId: string | null;
  /** Which trip the current day focus belongs to, so it resets across trips. */
  dayScopeTripId: string | null;
  workspaceTab: WorkspaceTab;
  mapFilters: MapFilter[];
  mapSearch: string;
  sheetSnap: SheetSnap;
  toggleSidebar: () => void;
  setAssistantOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  selectPlace: (id: string | null) => void;
  hoverPlace: (id: string | null) => void;
  setActiveDay: (id: string | null) => void;
  /** Focus today when the trip covers it, otherwise the first day. */
  focusDefaultDay: (tripId: string, days: Array<{ id: string; date: string }>, today?: string) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  toggleMapFilter: (filter: MapFilter) => void;
  setMapSearch: (q: string) => void;
  setSheetSnap: (snap: SheetSnap) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      assistantOpen: false,
      commandOpen: false,
      selectedPlaceId: null,
      hoverPlaceId: null,
      activeDayId: null,
      dayScopeTripId: null,
      workspaceTab: "itinerary",
      mapFilters: [],
      mapSearch: "",
      sheetSnap: "half",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      selectPlace: (selectedPlaceId) => set({ selectedPlaceId }),
      hoverPlace: (hoverPlaceId) => set({ hoverPlaceId }),
      setActiveDay: (activeDayId) => set({ activeDayId }),
      focusDefaultDay: (tripId, days, today) =>
        set((s) => {
          // Keep whatever the traveller chose while they stay on this trip,
          // including the explicit "全部" choice.
          if (s.dayScopeTripId === tripId) return {};
          const stamp = today ?? new Date().toISOString().slice(0, 10);
          const day = days.find((candidate) => candidate.date === stamp) ?? days[0];
          return { dayScopeTripId: tripId, activeDayId: day?.id ?? null };
        }),
      setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
      toggleMapFilter: (filter) =>
        set((s) => ({
          mapFilters: s.mapFilters.includes(filter)
            ? s.mapFilters.filter((f) => f !== filter)
            : [...s.mapFilters, filter],
        })),
      setMapSearch: (mapSearch) => set({ mapSearch }),
      setSheetSnap: (sheetSnap) => set({ sheetSnap }),
    }),
    {
      name: "voyage-ui",
      // The focused day is remembered across reloads. It is stored together with
      // the trip it belongs to, so opening a different trip re-derives the focus
      // instead of inheriting a day id that may not exist there.
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        activeDayId: s.activeDayId,
        dayScopeTripId: s.dayScopeTripId,
      }),
    },
  ),
);
