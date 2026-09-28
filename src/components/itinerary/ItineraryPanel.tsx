"use client";

import { DayTimeline } from "./DayTimeline";
import { DayTabs } from "./DayTabs";
import { DayFocusCard } from "./DayFocusCard";
import { useDayFocus } from "./useDayFocus";
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
  const activeDayId = useDayFocus();

  // Focusing one day by default is the whole point: a traveller looking at
  // "Day 2" should not have to read three days of stops at once. "全部" is an
  // explicit choice, so null still renders every day.
  const visibleDays = activeDayId === null ? trip.days : trip.days.filter((day) => day.id === activeDayId);
  // The focus card answers "what do I do today", so it only appears when a
  // single day is in focus — not in the all-days overview.
  const focusedDay = activeDayId === null ? undefined : visibleDays[0];

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
      <div className="border-b border-border px-3 pb-2.5">
        <DayTabs />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {focusedDay ? <DayFocusCard day={focusedDay} className="px-4 pt-3" /> : null}
        <SocialEvidencePanel
          evidence={trip.socialEvidence}
          warnings={trip.socialWarnings}
          platformStatus={trip.socialPlatformStatus}
          queryStatus={trip.socialQueryStatus}
          planningMetadata={trip.planningMetadata}
        />
        {visibleDays.map((day) => (
          <DayTimeline key={day.id} day={day} />
        ))}
      </div>
    </div>
  );
}
