"use client";

import { useState } from "react";
import { DayTimeline } from "./DayTimeline";
import { DayTabs } from "./DayTabs";
import { DayFocusCard } from "./DayFocusCard";
import { useDayFocus } from "./useDayFocus";
import { SocialEvidencePanel } from "./SocialEvidencePanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTripStore } from "@/store/trip-store";
import { useUiStore, type WorkspaceTab } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { setTaskStatus } from "@/services/trip-commands";
import type { TaskStatus } from "@/types/travel";

/**
 * The tasks tab renders inline (the standalone /tasks page was removed with
 * the page-count reduction). Toggles persist through the runtime now — they
 * participate in the same check-in linkage as the today screen.
 */
function TaskList() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const setTrip = useTripStore((s) => s.setTrip);
  const revision = useTripStore((s) => s.revision);
  const done = trip.tasks.filter((t) => t.status === "done").length;
  const before = trip.tasks.filter((t) => t.group === "before");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const toggle = (id: string) => {
    const task = trip.tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    const nextStatus: TaskStatus = task.status === "done" ? "todo" : "done";
    // Optimistic flip, then a revision-locked server write with rollback.
    patch((t) => ({
      ...t,
      tasks: t.tasks.map((candidate) =>
        candidate.id === id ? { ...candidate, status: nextStatus } : candidate,
      ),
    }));
    setSavingTaskId(id);
    void setTaskStatus({ tripId: trip.id, taskId: id, status: nextStatus, expectedTripRevision: useTripStore.getState().revision })
      .then(({ trip: saved, revision: savedRevision }) => {
        setTrip(saved, savedRevision);
        setSavingTaskId(null);
      })
      .catch(() => {
        setTrip(trip, revision);
        setSavingTaskId(null);
        toast.error("任务状态保存失败，请重试");
      });
  };

  if (trip.tasks.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">这趟行程暂无待办任务。</p>;
  }

  return (
    <div className="space-y-5 px-4 pb-6">
      <p className="text-right text-[13px] text-muted-foreground">{done} / {trip.tasks.length}</p>
      <section>
        <h3 className="text-[13px] font-medium text-muted-foreground">旅行前</h3>
        <ul className="mt-2 space-y-1">
          {before.map((task) => (
            <TaskRow
              key={task.id}
              title={task.title}
              done={task.status === "done"}
              disabled={savingTaskId === task.id}
              onToggle={() => toggle(task.id)}
            />
          ))}
        </ul>
      </section>
      {trip.days.map((day) => {
        const items = trip.tasks.filter((t) => t.dayId === day.id);
        if (!items.length) return null;
        return (
          <section key={day.id}>
            <h3 className="text-[13px] font-medium text-muted-foreground">Day {day.index + 1}</h3>
            <ul className="mt-2 space-y-1">
              {items.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.title}
                  done={task.status === "done"}
                  checkin={task.checkin}
                  disabled={savingTaskId === task.id}
                  onToggle={() => toggle(task.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({
  title,
  done,
  checkin,
  disabled = false,
  onToggle,
}: {
  title: string;
  done: boolean;
  checkin?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-[10px] px-2 py-2 hover:bg-secondary">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "grid size-4 place-items-center rounded border transition-opacity",
          done ? "border-primary bg-primary text-[10px] text-white" : "border-border",
          disabled && "opacity-50",
        )}
        aria-checked={done}
        role="checkbox"
      >
        {done ? "✓" : ""}
      </button>
      <span className={cn("flex-1 text-sm", done && "text-muted-foreground line-through")}>{title}</span>
      {checkin ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" />
          到达后打卡
        </span>
      ) : null}
    </li>
  );
}

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
            if (next === "book") router.push(`/trip/${trip.id}/offers`);
            if (next === "tasks") router.push(`/trip/${trip.id}`);
            if (next === "itinerary") router.push(`/trip/${trip.id}`);
          }}
        >
          <TabsList>
            <TabsTrigger value="itinerary">行程</TabsTrigger>
            <TabsTrigger value="explore">探索</TabsTrigger>
            <TabsTrigger value="book">推荐</TabsTrigger>
            <TabsTrigger value="tasks">任务</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="border-b border-border px-3 pb-2.5">
        <DayTabs />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {tab === "tasks" ? (
          <TaskList />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
