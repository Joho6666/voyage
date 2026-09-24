"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { ItineraryPanel } from "./ItineraryPanel";
import { useUiStore } from "@/store/ui-store";
import type { MapMode } from "@/features/journey-map/models/map-state";

const HEIGHT = { collapsed: "22%", half: "52%", full: "88%" } as const;

export function MobileTripSheet() {
  const snap = useUiStore((s) => s.sheetSnap);
  const setSnap = useUiStore((s) => s.setSheetSnap);
  const pathname = usePathname();

  const mapMode: MapMode = useMemo(() => {
    if (pathname.includes("/today")) return "TODAY";
    if (pathname.includes("/explore")) return "EXPLORE";
    return "PLAN";
  }, [pathname]);

  return (
    <div className="relative h-full bg-[#f4f5f7]">
      <div className="absolute inset-0">
        <MapCanvas mode={mapMode} />
      </div>
      <motion.div
        className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-t-[14px] border-t border-border bg-surface pb-14 shadow-[var(--shadow-float)]"
        animate={{ height: HEIGHT[snap] }}
        transition={{ type: "spring", stiffness: 280, damping: 32 }}
      >
        <button
          type="button"
          className="flex w-full justify-center py-2"
          aria-label="调整行程面板高度"
          onClick={() => setSnap(snap === "collapsed" ? "half" : snap === "half" ? "full" : "collapsed")}
        >
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </button>
        <div className="h-[calc(100%-28px)] overflow-hidden">
          <ItineraryPanel />
        </div>
      </motion.div>
    </div>
  );
}
