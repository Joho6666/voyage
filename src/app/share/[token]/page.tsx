"use client";

import { useEffect, useState } from "react";
import { MapCanvas } from "@/components/map/MapCanvas";
import type { Trip } from "@/types/travel";
import { hydrateTrip } from "@/store/trip-store";

export default function SharePage({ params }: { params: { token: string } }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void fetch(`/api/voyage/share?token=${encodeURIComponent(params.token)}`).then(async (r) => { const d = await r.json() as { trip?: Trip; error?: string }; if (!r.ok || !d.trip) setError(d.error ?? "分享链接不可用"); else { hydrateTrip(d.trip); setTrip(d.trip); } }); }, [params.token]);
  if (error) return <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted-foreground">{error}</main>;
  if (!trip) return <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted-foreground">正在加载共享行程…</main>;
  return <main className="min-h-dvh bg-background"><header className="border-b border-border bg-surface px-6 py-4"><p className="text-xs uppercase tracking-[0.18em] text-primary">Voyage · 只读分享</p><h1 className="mt-1 text-xl font-semibold">{trip.title}</h1><p className="mt-1 text-sm text-muted-foreground">{trip.destination} · {trip.startDate} 至 {trip.endDate} · {trip.travelers} 人</p></header><div className="grid min-h-[calc(100dvh-100px)] md:grid-cols-[380px_1fr]"><section className="order-2 overflow-y-auto p-5 md:order-1">{trip.days.map((day) => <article key={day.id} className="border-b border-border py-4"><p className="text-xs font-semibold text-primary">DAY {day.index + 1} · {day.date}</p><h2 className="mt-1 font-medium">{day.title}</h2><div className="mt-3 space-y-2">{trip.items.filter((item) => item.dayId === day.id).sort((a,b) => a.order-b.order).map((item) => <div key={item.id} className="rounded-xl border border-border bg-surface p-3 text-sm">{trip.places.find((place) => place.id === item.placeId)?.name}<span className="ml-2 text-xs text-muted-foreground">{item.startTime}</span></div>)}</div></article>)}</section><section className="order-1 min-h-[42vh] md:order-2"><MapCanvas mode="PLAN" /></section></div></main>;
}
