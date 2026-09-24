"use client";

import { CloudRain, MoreHorizontal, Share2, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCny, formatMonthDay, tripDurationLabel } from "@/lib/utils";
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
              {weather.provenance?.source === "unavailable" || weather.condition === "天气未知"
                ? `${weather.condition} · ${trip.days[0]?.date ?? ""}`
                : `${weather.tempC}°C ${weather.condition}`}
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
            <DropdownMenuItem onSelect={() => toast.message("已复制行程摘要")}>复制摘要</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.message("导出 PDF 将在后续版本提供")}>导出 PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button size="sm" onClick={() => setAssistantOpen(true)}>
        <Sparkles className="size-3.5" />
        AI Assistant
      </Button>
    </header>
  );
}
