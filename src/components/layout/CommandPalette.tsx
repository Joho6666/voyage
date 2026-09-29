"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Navigation, MapPin, Compass, Search } from "lucide-react";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";

/**
 * Cmd+K is navigation and place search only. AI adjustments live on the
 * today page (one-tap buttons + a free-form input) so a traveller never has
 * to guess which of three overlapping AI surfaces to use.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const selectPlace = useUiStore((s) => s.selectPlace);
  const trip = useTripStore((s) => s.trip);
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

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-[var(--overlay)] flex items-start justify-center pt-[10vh] p-4" onClick={() => setOpen(false)}>
      <Command
        className="w-full max-w-xl overflow-hidden rounded-[16px] border border-border bg-surface shadow-[var(--shadow-float)] animate-in fade-in-0 zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-border px-3.5">
          <Search className="size-4 text-muted-foreground shrink-0 mr-2.5" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="搜索页面或行程地点…"
            className="h-13 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 text-foreground"
          />
          <span className="text-[11px] text-muted-foreground/60 border border-border px-1.5 py-0.5 rounded font-mono">
            Esc
          </span>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
          <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
            没有匹配的页面或地点
          </Command.Empty>

          <Command.Group heading="页面跳转" className="px-1 py-1.5 text-[11px] font-medium text-muted-foreground">
            <Item onSelect={() => go(`/trip/${trip.id}`)}>
              <Compass className="size-3.5 mr-2 text-muted-foreground" />
              <span>行程总览 Itinerary</span>
            </Item>
            <Item onSelect={() => go(`/trip/${trip.id}/today`)}>
              <Navigation className="size-3.5 mr-2 text-primary" />
              <span>Today 现场模式 (单手执行控制台)</span>
            </Item>
            <Item onSelect={() => go(`/trip/${trip.id}/explore`)}>
              <MapPin className="size-3.5 mr-2 text-muted-foreground" />
              <span>Explore 真实地点探索</span>
            </Item>
            <Item onSelect={() => go("/trips")}>
              我的行程列表 Trips
            </Item>
          </Command.Group>

          {places.length ? (
            <Command.Group heading="行程地点" className="px-1 py-1.5 text-[11px] font-medium text-muted-foreground">
              {places.slice(0, 8).map((p) => (
                <Item
                  key={p.id}
                  onSelect={() => {
                    selectPlace(p.id);
                    setOpen(false);
                  }}
                >
                  <MapPin className="size-3.5 mr-2 text-primary/70" />
                  <span className="truncate">{p.name}</span>
                </Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </div>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center rounded-[8px] px-2.5 py-2 text-[13px] text-foreground aria-selected:bg-secondary transition-colors"
    >
      {children}
    </Command.Item>
  );
}
