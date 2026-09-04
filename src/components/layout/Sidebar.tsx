"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, Compass, User as UserIcon } from "lucide-react";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { useTripStore } from "@/store/trip-store";
import { useUiStore } from "@/store/ui-store";
import { getCurrentUser } from "@/services/supabase/auth";
import type { User } from "@supabase/supabase-js";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { bottomNav, globalNav, tripNav } from "./nav";

export function Sidebar({ tripId }: { tripId?: string }) {
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const trip = useTripStore((s) => s.trip);
  const items = tripId ? tripNav(tripId) : [];

  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    void getCurrentUser().then(setUser);
  }, []);

  const displayName = user?.user_metadata?.name || user?.email?.split("@")[0] || "游客";
  const displaySub = user?.email || "点击登录与同步";

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

        {/* User Account Button with AuthDialog */}
        <button
          type="button"
          onClick={() => setAuthOpen(true)}
          className={cn(
            "mt-2 flex w-full items-center gap-2 rounded-[8px] p-1.5 text-left hover:bg-secondary transition-colors",
            collapsed && "justify-center p-1",
          )}
          title={user?.email ? `已登录: ${user.email}` : "点击登录"}
        >
          <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary text-[12px] font-medium shrink-0">
            {user?.email ? user.email.slice(0, 1).toUpperCase() : <UserIcon className="size-4" />}
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{displayName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{displaySub}</p>
            </div>
          ) : null}
        </button>

        <button
          type="button"
          onClick={toggle}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-[8px] text-muted-foreground hover:bg-secondary"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
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
