"use client";

import { MapPin } from "lucide-react";
import { useTripStore } from "@/store/trip-store";
import { cn } from "@/lib/utils";

export default function TasksPage() {
  const trip = useTripStore((s) => s.trip);
  const patch = useTripStore((s) => s.patchTrip);
  const done = trip.tasks.filter((t) => t.status === "done").length;
  const before = trip.tasks.filter((t) => t.group === "before");

  const toggle = (id: string) => {
    patch((t) => ({
      ...t,
      tasks: t.tasks.map((task) =>
        task.id === id ? { ...task, status: task.status === "done" ? "todo" : "done" } : task,
      ),
    }));
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <div className="flex items-end justify-between">
        <h1 className="text-lg font-medium">任务</h1>
        <p className="text-[13px] text-muted-foreground">
          {done} / {trip.tasks.length}
        </p>
      </div>
      <section className="mt-5">
        <h2 className="text-[13px] font-medium text-muted-foreground">旅行前</h2>
        <ul className="mt-2 space-y-1">
          {before.map((task) => (
            <TaskRow key={task.id} title={task.title} done={task.status === "done"} onToggle={() => toggle(task.id)} />
          ))}
        </ul>
      </section>
      {trip.days.map((day) => {
        const items = trip.tasks.filter((t) => t.dayId === day.id);
        if (!items.length) return null;
        return (
          <section key={day.id} className="mt-6">
            <h2 className="text-[13px] font-medium text-muted-foreground">Day {day.index + 1}</h2>
            <ul className="mt-2 space-y-1">
              {items.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.title}
                  done={task.status === "done"}
                  checkin={task.checkin}
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
  onToggle,
}: {
  title: string;
  done: boolean;
  checkin?: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-[10px] px-2 py-2 hover:bg-secondary">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "grid size-4 place-items-center rounded border",
          done ? "border-primary bg-primary text-[10px] text-white" : "border-border",
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
