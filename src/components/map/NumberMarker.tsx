import { DAY_COLORS } from "@/types/travel";
import { cn } from "@/lib/utils";
import type { MapMarker } from "@/services/map/types";

export function NumberMarker({
  marker,
  hovered,
  onSelect,
}: {
  marker: MapMarker;
  hovered?: boolean;
  onSelect: (id: string) => void;
}) {
  const color = DAY_COLORS[(marker.dayIndex ?? 0) % DAY_COLORS.length];
  const selected = marker.selected;

  return (
    <button
      type="button"
      onClick={() => onSelect(marker.id)}
      className={cn(
        "grid size-7 place-items-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-sm transition-transform duration-150",
        hovered && "scale-110",
        selected && "scale-125 ring-2 ring-offset-1",
      )}
      style={{ background: color, boxShadow: selected ? `0 0 0 3px ${color}33` : undefined }}
      aria-label={marker.title}
    >
      {marker.number ?? "·"}
    </button>
  );
}

export function KindDot({
  marker,
  onSelect,
}: {
  marker: MapMarker;
  onSelect: (id: string) => void;
}) {
  const fill =
    marker.kind === "hotel"
      ? "#1D4ED8"
      : marker.kind === "food" || marker.kind === "cafe"
        ? "#C2410C"
        : marker.kind === "activity"
          ? "#7C3AED"
          : "#57534E";
  return (
    <button
      type="button"
      onClick={() => onSelect(marker.id)}
      className={cn(
        "size-3 rounded-full border-2 border-white transition-transform",
        marker.selected && "scale-150",
      )}
      style={{ background: fill }}
      aria-label={marker.title}
    />
  );
}
