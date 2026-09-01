"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DayHeader } from "./DayHeader";
import { PoiCard } from "./PoiCard";
import { TravelSegment } from "./TravelSegment";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import type { Day } from "@/types/travel";

export function DayTimeline({ day }: { day: Day }) {
  const trip = useTripStore((s) => s.trip);
  const reorder = useTripStore((s) => s.reorder);
  const setActiveDay = useUiStore((s) => s.setActiveDay);
  const items = trip.items.filter((i) => i.dayId === day.id).sort((a, b) => a.order - b.order);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorder(day.id, next);
  };

  return (
    <section onMouseEnter={() => setActiveDay(day.id)} className="border-b border-border last:border-b-0">
      <DayHeader trip={trip} day={day} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="py-2">
            {items.map((item, index) => {
              const place = trip.places.find((p) => p.id === item.placeId);
              const next = items[index + 1];
              const segment = trip.segments.find((s) => s.fromItemId === item.id && s.toItemId === next?.id);
              if (!place) return null;
              return (
                <div key={item.id}>
                  <PoiCard item={item} place={place} index={index} dayIndex={day.index} />
                  {segment ? <TravelSegment segment={segment} /> : null}
                </div>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
