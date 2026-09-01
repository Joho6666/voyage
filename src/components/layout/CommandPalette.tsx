"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const trip = useTripStore((s) => s.trip);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const setActiveDay = useUiStore((s) => s.setActiveDay);
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const places = useMemo(
    () => trip.places.filter((p) => p.name.includes(query) || query === ""),
    [query, trip.places],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-[var(--overlay)]" onClick={() => setOpen(false)}>
      <Command
        className="mx-auto mt-[12vh] w-[min(92vw,560px)] overflow-hidden rounded-[14px] border border-border bg-surface shadow-[var(--shadow-float)]"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="搜索景点、旅行、任务…"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
          <Command.Empty className="px-3 py-6 text-sm text-muted-foreground">没有匹配结果</Command.Empty>
          <Command.Group heading="导航" className="px-1 py-1 text-[12px] text-muted-foreground">
            <Item onSelect={() => { router.push(`/trip/${trip.id}`); setOpen(false); }}>打开行程</Item>
            <Item onSelect={() => { router.push(`/trip/${trip.id}/today`); setOpen(false); }}>打开 Today Mode</Item>
            <Item onSelect={() => { router.push("/new-trip"); setOpen(false); }}>创建新旅行</Item>
            <Item onSelect={() => { router.push("/trips"); setOpen(false); }}>我的旅行</Item>
          </Command.Group>
          <Command.Group heading="日程" className="px-1 py-1 text-[12px] text-muted-foreground">
            {trip.days.map((day) => (
              <Item
                key={day.id}
                onSelect={() => {
                  setActiveDay(day.id);
                  router.push(`/trip/${trip.id}`);
                  setOpen(false);
                }}
              >
                打开 Day {day.index + 1} · {day.title}
              </Item>
            ))}
          </Command.Group>
          <Command.Group heading="地点" className="px-1 py-1 text-[12px] text-muted-foreground">
            {places.slice(0, 8).map((place) => (
              <Item
                key={place.id}
                onSelect={() => {
                  selectPlace(place.id);
                  setOpen(false);
                }}
              >
                {place.name}
              </Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center rounded-[8px] px-2 py-2 text-sm text-foreground aria-selected:bg-secondary"
    >
      {children}
    </Command.Item>
  );
}
