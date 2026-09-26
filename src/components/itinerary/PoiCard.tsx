"use client";

import { useEffect, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Star } from "lucide-react";
import { TravelImage } from "@/components/travel/TravelImage";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PLACE_CATEGORY_LABEL, type ItineraryItem, type Place } from "@/types/travel";
import { DAY_COLORS } from "@/types/travel";
import { cn } from "@/lib/utils";
import { travelAgent } from "@/services/ai";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";

export function PoiCard({
  item,
  place,
  index,
  dayIndex,
}: {
  item: ItineraryItem;
  place: Place;
  index: number;
  dayIndex: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const selectPlace = useUiStore((s) => s.selectPlace);
  const selected = useUiStore((s) => s.selectedPlaceId === place.id);
  const isHovered = useUiStore((s) => s.hoverPlaceId === place.id);
  const hoverPlace = useUiStore((s) => s.hoverPlace);
  const patch = useTripStore((s) => s.patchTrip);
  const color = DAY_COLORS[dayIndex % DAY_COLORS.length];
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (selected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selected]);

  const setCombinedRef = (node: HTMLElement | null) => {
    setNodeRef(node);
    cardRef.current = node;
  };

  return (
    <article
      data-testid="itinerary-card"
      data-place-id={place.id}
      data-selected={selected ? "true" : "false"}
      ref={setCombinedRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex gap-3 rounded-[12px] border border-transparent px-3 py-2 hover:bg-secondary/70 transition-all cursor-pointer",
        selected && "border-primary/40 bg-accent ring-1 ring-primary/20",
        isHovered && !selected && "bg-secondary/80 border-border/70",
        isDragging && "z-10 bg-surface shadow-[var(--shadow-float)]",
      )}
      onClick={() => selectPlace(place.id)}
      onMouseEnter={() => hoverPlace(place.id)}
      onMouseLeave={() => hoverPlace(null)}
    >
      <div className="w-10 shrink-0 pt-1 text-right text-[12px] tabular-nums text-muted-foreground">
        {item.startTime}
      </div>
      <div className="flex min-w-0 flex-1 gap-3">
        <div
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
          style={{ background: color }}
        >
          {String(index + 1).padStart(2, "0")}
        </div>
        <TravelImage src={place.image} alt={place.name} className="h-[72px] w-[96px] rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-medium">{place.name}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-[8px] p-1 text-muted-foreground opacity-0 hover:bg-secondary group-hover:opacity-100"
                  aria-label="更多"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => patch((t) => travelAgent.removeItem(t, item.id))}>
                  从行程移除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span>{PLACE_CATEGORY_LABEL[place.category]}</span>
            <span className="inline-flex items-center gap-0.5">
              <Star className="size-3 fill-current" />
              {place.rating.toFixed(1)}
            </span>
            <span>{place.priceLabel}</span>
            <span>{item.duration} min</span>
            <span>{place.openingStatus === "open" ? "营业中" : null}</span>
          </p>
          <p className="mt-1 line-clamp-1 text-[12px] leading-4 text-muted-foreground">{place.description}</p>
        </div>
        <button
          type="button"
          className="self-center text-muted-foreground opacity-0 group-hover:opacity-100"
          aria-label="拖动排序"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-4" />
        </button>
      </div>
    </article>
  );
}
