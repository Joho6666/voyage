"use client";

import { DayTimeline } from "./DayTimeline";
import { SocialEvidencePanel } from "./SocialEvidencePanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTripStore } from "@/store/trip-store";
import { useUiStore, type WorkspaceTab } from "@/store/ui-store";
import { useRouter } from "next/navigation";

export function ItineraryPanel() {
  const trip = useTripStore((s) => s.trip);
  const tab = useUiStore((s) => s.workspaceTab);
  const setTab = useUiStore((s) => s.setWorkspaceTab);
  const router = useRouter();

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-12 items-center px-3">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            const next = v as WorkspaceTab;
            setTab(next);
            if (next === "explore") router.push(`/trip/${trip.id}/explore`);
            if (next === "book") router.push(`/trip/${trip.id}/hotels`);
            if (next === "tasks") router.push(`/trip/${trip.id}/tasks`);
            if (next === "itinerary") router.push(`/trip/${trip.id}`);
          }}
        >
          <TabsList>
            <TabsTrigger value="itinerary">行程</TabsTrigger>
            <TabsTrigger value="explore">探索</TabsTrigger>
            <TabsTrigger value="book">预订</TabsTrigger>
            <TabsTrigger value="tasks">任务</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <SocialEvidencePanel evidence={trip.socialEvidence} warnings={trip.socialWarnings} />
        {trip.days.map((day) => (
          <DayTimeline key={day.id} day={day} />
        ))}
      </div>
    </div>
  );
}
