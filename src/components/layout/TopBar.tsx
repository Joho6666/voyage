"use client";

import { CloudRain, MoreHorizontal, Share2, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCny, formatMonthDay, tripDurationLabel } from "@/lib/utils";
import { weatherDisplay } from "@/lib/weather-display";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { toast } from "sonner";

export function TopBar() {
  const trip = useTripStore((s) => s.trip);
  const setAssistantOpen = useUiStore((s) => s.setAssistantOpen);
  const weather = trip.days[1]?.weather ?? trip.days[0]?.weather;
  const share = async () => {
    const response = await fetch("/api/voyage/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tripId: trip.id }) });
    const data = await response.json() as { token?: string };
    if (!data.token) { toast.error("分享链接生成失败"); return; }
    const url = `${window.location.origin}/share/${data.token}`;
    await navigator.clipboard?.writeText(url);
    toast.success("只读分享链接已复制");
  };

  /** A real clipboard write of a real summary — the old version only toasted. */
  const copySummary = async () => {
    const summary = [
      `${trip.destination} · ${tripDurationLabel(trip.startDate, trip.endDate)} · ${trip.travelers} 人 · 预算 ${formatCny(trip.budget)}`,
      trip.days
        .map((day) => {
          const stops = trip.items
            .filter((item) => item.dayId === day.id)
            .sort((a, b) => a.order - b.order)
            .map((item) => trip.places.find((place) => place.id === item.placeId)?.name ?? "")
            .filter(Boolean);
          return `Day ${day.index + 1}（${day.date}）：${stops.join(" → ") || "暂无安排"}`;
        })
        .join("\n"),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      toast.success("行程摘要已复制");
    } catch {
      toast.error("复制失败，浏览器可能未授权剪贴板访问");
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="font-medium">
            {trip.destination} · {tripDurationLabel(trip.startDate, trip.endDate)}
          </span>
          <span className="text-muted-foreground">
            {formatMonthDay(trip.startDate)} – {formatMonthDay(trip.endDate)}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Users className="size-3.5" />
            {trip.travelers} 人
          </span>
          {weather ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CloudRain className="size-3.5" />
              {weatherDisplay(weather).text}
              {weather.provenance?.source === "unavailable" ? ` · ${trip.days[0]?.date ?? ""}` : ""}
            </span>
          ) : null}
          <span className="text-muted-foreground">预算 {formatCny(trip.budget)}</span>
        </div>
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        <Button variant="ghost" size="sm" onClick={() => void share()}>
          邀请好友
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void share()}>
          <Share2 className="size-3.5" />
          分享
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="更多">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => void copySummary()}>复制摘要</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button size="sm" onClick={() => setAssistantOpen(true)}>
        <Sparkles className="size-3.5" />
        AI 助手
      </Button>
    </header>
  );
}
