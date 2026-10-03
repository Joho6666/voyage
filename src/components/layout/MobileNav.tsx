"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Map, MoreHorizontal, Route, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { bottomNav, globalNav, tripNavGroups } from "./nav";

const primaryItems = [
  { id: "itinerary", href: "", label: "行程", icon: Route },
  { id: "today", href: "/today", label: "今天", icon: LayoutDashboard },
  // "地图" lands on the trip root with the sheet collapsed: the full-bleed
  // map lives behind the trip sheet, and /explore is a POI list without a
  // map on phones. Same destination, different sheet state — the two
  // entries are the two views of the trip page.
  { id: "map", href: "", label: "地图", icon: Map },
] as const;

function TripMobileNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const sheetSnap = useUiStore((s) => s.sheetSnap);
  const [moreOpen, setMoreOpen] = useState(false);
  const base = `/trip/${tripId}`;
  const groups = tripNavGroups(tripId);

  const closeMore = () => setMoreOpen(false);

  // The "更多" sheet acted like a dialog but ignored Escape entirely.
  useEffect(() => {
    if (!moreOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [moreOpen]);

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 bg-foreground/30 md:hidden" onClick={closeMore} aria-hidden="true" />
      ) : null}
      {moreOpen ? (
        <div
          role="dialog"
          aria-label="更多页面"
          className="fixed inset-x-0 bottom-14 z-50 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-6 shadow-[0_-14px_45px_rgba(28,25,23,0.14)] md:hidden"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">全部页面</p>
            <button type="button" onClick={closeMore} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="收起更多页面">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="mb-1.5 text-[10px] text-muted-foreground">{group.title}</p>
                <div className="grid grid-cols-4 gap-2">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeMore}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-xl border border-border bg-background px-2 py-2.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground",
                          pathname === item.href && "border-primary/40 bg-accent text-accent-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground">其他</p>
              <div className="grid grid-cols-4 gap-2">
                {bottomNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={closeMore} className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-background px-2 py-2.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground">
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="移动端主导航">
        <ul className="grid grid-cols-4">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const href = `${base}${item.href}`;
            // On the trip page the two entries are distinguished by the sheet
            // state, not by the URL.
            const active = item.id === "map"
              ? pathname === base && sheetSnap === "collapsed"
              : item.id === "itinerary"
                ? pathname === base && sheetSnap !== "collapsed"
                : pathname === `${base}${item.href}`;
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  onClick={() => {
                    // Mirror the trip sheet behaviour: the map reads best with
                    // the panel collapsed, the itinerary with it half open.
                    if (item.id === "map") useUiStore.getState().setSheetSnap("collapsed");
                    if (item.id === "itinerary") useUiStore.getState().setSheetSnap("half");
                  }}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
                    active && "text-primary",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground"
            >
              <MoreHorizontal className="size-4" />
              更多
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

/** Global bottom navigation for pages outside a trip (trips, settings). */
export function AppMobileNav() {
  const pathname = usePathname();
  const items = [...globalNav, ...bottomNav];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="全局导航">
      <ul className="grid grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
                  pathname === item.href && "text-primary",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export { TripMobileNav as MobileNav };
