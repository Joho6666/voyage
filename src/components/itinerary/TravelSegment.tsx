import { formatKm } from "@/lib/utils";
import type { RouteSegment } from "@/types/travel";

export function TravelSegment({ segment }: { segment: RouteSegment }) {
  return (
    <div className="flex items-center gap-3 py-1 pl-12 pr-4 text-[12px] text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>
        {segment.label} {segment.minutes} min · {formatKm(segment.meters)}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
