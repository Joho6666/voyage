"use client";

import Link from "next/link";
import { CheckSquare, Compass, Map, Route, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";

const items = [
  { id: "itinerary", href: "", label: "行程", icon: Route },
  { id: "map", href: "", label: "地图", icon: Map },
  { id: "explore", href: "/explore", label: "探索", icon: Compass },
  { id: "tasks", href: "/tasks", label: "任务", icon: CheckSquare },
  { id: "me", href: "/settings", label: "我的", icon: User },
] as const;

export function MobileNav({ tripId }: { tripId: string }) {
  const tab = useUiStore((s) => s.mobileTab);
  const setTab = useUiStore((s) => s.setMobileTab);
  const setSheet = useUiStore((s) => s.setSheetSnap);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          const href =
            item.id === "me"
              ? "/settings"
              : item.id === "explore"
                ? `/trip/${tripId}/explore`
                : item.id === "tasks"
                  ? `/trip/${tripId}/tasks`
                  : `/trip/${tripId}`;
          return (
            <li key={item.id}>
              <Link
                href={href}
                onClick={() => {
                  setTab(item.id);
                  if (item.id === "map") setSheet("collapsed");
                  if (item.id === "itinerary") setSheet("half");
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
      </ul>
    </nav>
  );
}
