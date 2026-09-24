"use client";

import { TravelImage } from "@/components/travel/TravelImage";
import { AddToDay } from "@/components/travel/AddToDay";
import { useTripStore } from "@/store/trip-store";
import { formatCny, formatShortDate } from "@/lib/utils";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LiveDiscovery } from "@/components/travel/LiveDiscovery";

export default function ActivitiesPage() {
  const trip = useTripStore((s) => s.trip);
  const { id } = useParams<{ id: string }>();

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">当地活动</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">时间已对齐你的旅行日期。</p>
      <LiveDiscovery city={trip.destination} kind="activity" query="演出 展览 景点体验 休闲娱乐" title={`${trip.destination} 可探索的体验与活动`} />
      <div className="mt-4 space-y-4">
        {trip.activities.map((activity) => (
          <article key={activity.id} className="overflow-hidden rounded-[14px] border border-border">
            <TravelImage src={activity.banner} alt={activity.name} ratio="16/9" />
            <div className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium">{activity.name}</h2>
                  <p className="text-[12px] text-muted-foreground">
                    {formatShortDate(activity.date)} · {activity.startTime}–{activity.endTime} · {activity.venue}
                  </p>
                </div>
                <p className="text-sm">{activity.price ? formatCny(activity.price) : "免费"}</p>
              </div>
              <p className="text-[13px] text-muted-foreground">{activity.insight}</p>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">{activity.remaining}</span>
                <AddToDay placeId={activity.placeId} label="加入行程" />
              </div>
            </div>
          </article>
        ))}
        {trip.activities.length === 0 ? <div className="mt-4 rounded-[14px] border border-dashed border-border p-5 text-center"><p className="text-sm font-medium">暂无已加入行程的活动</p><p className="mt-1 text-xs text-muted-foreground">上方显示的是城市 POI 发现，不代表有票或指定日期场次。</p><Button asChild size="sm" variant="outline" className="mt-3"><Link href={`/trip/${encodeURIComponent(id)}/offers`}>查看门票与外部推荐</Link></Button></div> : null}
      </div>
    </div>
  );
}
