"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, Compass } from "lucide-react";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { bottomNav, globalNav, tripNav } from "./nav";

export function Sidebar({ tripId }: { tripId?: string }) {
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const trip = useTripStore((s) => s.trip);
  const items = tripId ? tripNav(tripId) : [];

  return (
    <aside
      className={cn(
        "hidden h-dvh shrink-0 flex-col border-r border-border bg-surface md:flex",
        collapsed ? "w-16" : "w-[220px]",
      )}
    >
      <div className={cn("flex h-14 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Link href="/" className="flex items-center gap-2 rounded-[8px] px-1 py-1">
          <span className="grid size-7 place-items-center rounded-[8px] bg-primary text-[12px] font-semibold text-primary-foreground">
            V
          </span>
          {!collapsed ? (
            <span className="text-sm font-medium tracking-tight">
              {brand.name}
              <span className="ml-1 text-muted-foreground">{brand.product}</span>
            </span>
          ) : null}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-3 scrollbar-thin">
        <NavGroup collapsed={collapsed} items={globalNav} pathname={pathname} />

        {tripId ? (
          <div>
            {!collapsed ? (
              <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                当前 Trip
              </p>
            ) : null}
            {!collapsed ? (
              <p className="mb-2 truncate px-2 text-[13px] font-medium">{trip.title}</p>
            ) : (
              <div className="mb-2 flex justify-center">
                <Compass className="size-4 text-muted-foreground" />
              </div>
            )}
            <NavGroup collapsed={collapsed} items={items} pathname={pathname} />
          </div>
        ) : null}
      </nav>

      <div className="mt-auto border-t border-border p-2">
        <NavGroup collapsed={collapsed} items={bottomNav} pathname={pathname} />
        <div className={cn("mt-2 flex items-center gap-2 px-1", collapsed && "justify-center")}>
          <div className="grid size-8 place-items-center rounded-full bg-secondary text-[12px] font-medium">
            周
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">周行</p>
              <p className="truncate text-[12px] text-muted-foreground">zhou@voyage.app</p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggle}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-[8px] text-muted-foreground hover:bg-secondary"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
    </aside>
  );
}

function NavGroup({
  items,
  pathname,
  collapsed,
}: {
  items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const path = item.href.split("?")[0] ?? item.href;
        const active = pathname === path;
        const Icon = item.icon;
        return (
          <li key={`${item.href}-${item.label}`}>
            <Link
              href={item.href}
              title={item.label}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground",
                collapsed && "justify-center px-0",
                active && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
