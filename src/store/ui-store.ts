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
  activeDayId: string | null;
  workspaceTab: WorkspaceTab;
  mapFilters: MapFilter[];
  mapSearch: string;
  sheetSnap: SheetSnap;
  mobileTab: "itinerary" | "map" | "explore" | "tasks" | "me";
  toggleSidebar: () => void;
  setAssistantOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  selectPlace: (id: string | null) => void;
  hoverPlace: (id: string | null) => void;
  setActiveDay: (id: string | null) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  toggleMapFilter: (filter: MapFilter) => void;
  setMapSearch: (q: string) => void;
  setSheetSnap: (snap: SheetSnap) => void;
  setMobileTab: (tab: UiState["mobileTab"]) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      assistantOpen: false,
      commandOpen: false,
      selectedPlaceId: null,
      hoverPlaceId: null,
      activeDayId: "day-1",
      workspaceTab: "itinerary",
      mapFilters: [],
      mapSearch: "",
      sheetSnap: "half",
      mobileTab: "itinerary",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      selectPlace: (selectedPlaceId) => set({ selectedPlaceId }),
      hoverPlace: (hoverPlaceId) => set({ hoverPlaceId }),
      setActiveDay: (activeDayId) => set({ activeDayId }),
      setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
      toggleMapFilter: (filter) =>
        set((s) => ({
          mapFilters: s.mapFilters.includes(filter)
            ? s.mapFilters.filter((f) => f !== filter)
            : [...s.mapFilters, filter],
        })),
      setMapSearch: (mapSearch) => set({ mapSearch }),
      setSheetSnap: (sheetSnap) => set({ sheetSnap }),
      setMobileTab: (mobileTab) => set({ mobileTab }),
    }),
    {
      name: "voyage-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
