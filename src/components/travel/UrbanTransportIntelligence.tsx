"use client";

import { useMemo, useState } from "react";
import { Bus, CarTaxiFront, Footprints, Loader2, Route, TrainFront } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTripStore } from "@/store/trip-store";
import type { RouteOptionSet, UrbanTransportMode } from "@/types/transport-intelligence";

const MODE_LABEL: Record<UrbanTransportMode, string> = {
  walk: "步行",
  metro: "地铁/轨道",
  bus: "公交",
  taxi: "出租车/网约车",
  drive: "驾车",
};

function ModeIcon({ mode }: { mode: UrbanTransportMode }) {
  if (mode === "walk") return <Footprints className="size-3.5" />;
  if (mode === "metro") return <TrainFront className="size-3.5" />;
  if (mode === "bus") return <Bus className="size-3.5" />;
  return <CarTaxiFront className="size-3.5" />;
}

export function UrbanTransportIntelligence() {
  const trip = useTripStore((state) => state.trip);
  const [results, setResults] = useState<Record<string, RouteOptionSet>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const urbanSegments = useMemo(
    () => trip.segments.filter((segment) => ["walk", "metro", "bus", "taxi", "drive"].includes(segment.mode)),
    [trip.segments],
  );

  async function analyze(segmentId: string) {
    const segment = urbanSegments.find((candidate) => candidate.id === segmentId);
    if (!segment || busy) return;
    const from = trip.places.find((place) => place.id === segment.fromPlaceId);
    const to = trip.places.find((place) => place.id === segment.toPlaceId);
    const day = trip.days.find((candidate) => candidate.id === segment.dayId);
    if (!from || !to) return;

    setBusy(segmentId);
    setMessage("");
    try {
      const response = await fetch("/api/voyage/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "get-route-options",
          input: {
            origin: { lat: from.lat, lng: from.lng },
            destination: { lat: to.lat, lng: to.lng },
            city: trip.destination,
            fallbackPolicy: "estimated",
            context: {
              travelers: trip.travelers,
              walkingTolerance: "medium",
              weather: day?.weather.icon === "rain" || day?.weather.condition.includes("雨") ? "rain" : "unknown",
            },
          },
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        data?: { routeOptions?: RouteOptionSet };
        error?: { message?: string };
      };
      if (!response.ok || !payload.ok || !payload.data?.routeOptions) {
        throw new Error(payload.error?.message || "路线分析失败");
      }
      setResults((current) => ({ ...current, [segmentId]: payload.data!.routeOptions! }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "路线分析失败");
    } finally {
      setBusy(null);
    }
  }

  if (!urbanSegments.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
        当前行程还没有市内路段。生成或刷新行程后，Voyage 会在这里比较步行、地铁、公交和打车方案。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {urbanSegments.map((segment) => {
        const from = trip.places.find((place) => place.id === segment.fromPlaceId);
        const to = trip.places.find((place) => place.id === segment.toPlaceId);
        const routeOptions = results[segment.id];
        return (
          <article key={segment.id} className="rounded-[14px] border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground">市内路段</p>
                <h3 className="mt-1 text-sm font-semibold">{from?.name ?? "起点"} → {to?.name ?? "终点"}</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  当前 {MODE_LABEL[(segment.mode === "highspeed" || segment.mode === "flight" ? "taxi" : segment.mode) as UrbanTransportMode] ?? segment.mode}
                  · {segment.durationMinutes} 分钟 · {(segment.distanceMeters / 1000).toFixed(1)} km
                  · {segment.estimated ? "含估算" : "路线数据已验证"}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void analyze(segment.id)}>
                {busy === segment.id ? <Loader2 className="animate-spin" /> : <Route />}
                {routeOptions ? "刷新对比" : "智能对比"}
              </Button>
            </div>

            {routeOptions ? (
              <div className="mt-4">
                <p className="text-xs font-medium">
                  推荐：{MODE_LABEL[routeOptions.recommendedMode]}
                  <span className="ml-2 font-normal text-muted-foreground">按时间、费用、步行、换乘、天气与可靠性综合评分</span>
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {routeOptions.options.slice(0, 5).map((option, index) => (
                    <div key={option.id} className={"rounded-xl border p-3 " + (index === 0 ? "border-primary/40 bg-primary/5" : "border-border")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold"><ModeIcon mode={option.mode} />{MODE_LABEL[option.mode]}</span>
                        <strong className="text-sm">{option.score}</strong>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{option.durationMinutes} 分钟</span>
                        <span>步行 {option.walkMeters} m</span>
                        <span>换乘 {option.transferCount} 次</span>
                        <span>约 ¥{option.cost.min}{option.cost.max !== option.cost.min ? "–" + option.cost.max : ""}</span>
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                        {option.reasons.slice(0, 3).join(" · ")}
                        {option.estimated ? " · 估算数据" : " · 实时路线"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
      {message ? <p role="status" className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
