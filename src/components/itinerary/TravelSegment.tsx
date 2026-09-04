import { formatKm } from "@/lib/utils";
import type { RouteSegment } from "@/types/travel";

export function TravelSegment({ segment }: { segment: RouteSegment }) {
  const isReal = !segment.estimated && segment.provider === "amap";
  const meters = segment.distanceMeters ?? segment.meters ?? 0;
  const minutes = segment.durationMinutes ?? segment.minutes ?? 0;

  return (
    <div className="flex items-center gap-3 py-1 pl-12 pr-4 text-[12px] text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-2.5 py-0.5 border border-border/60">
        <span
          className={`size-1.5 rounded-full shrink-0 ${isReal ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-amber-500/80"}`}
          title={isReal ? "高德实时导航路线" : "直线距离预估路线"}
        />
        <span>
          {segment.label} {minutes} min · {formatKm(meters)}
        </span>
        <span className="text-[10px] text-muted-foreground/80 font-normal">
          {isReal ? "高德实时" : "预估"}
        </span>
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
