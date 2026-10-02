import type { LucideIcon } from "lucide-react";
import { Compass, LayoutDashboard, Map as MapIcon, Route, Ticket, Bus, Settings } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const globalNav: NavItem[] = [
  { href: "/trips", label: "我的旅行", icon: Route },
  // "规划" (the chat that builds a trip) — "探索" would collide with the
  // trip-internal explore page and its own bottom-nav label.
  { href: "/new-trip", label: "规划", icon: Compass },
];

export interface NavGroupDef {
  title: string;
  items: NavItem[];
}

/**
 * Trip navigation grouped by traveler mental model: planning → on-the-ground → support.
 * The page-count reduction folded food/hotels/activities into explore and
 * tasks/budget into the main page/today card, so the list below is the whole
 * surface — five destinations, one mental model.
 */
export function tripNavGroups(tripId: string): NavGroupDef[] {
  const base = `/trip/${tripId}`;
  return [
    {
      title: "今天",
      items: [
        // "今天做什么" leads: the first question a traveller has is what to do
        // now, not which dashboard to open.
        { href: `${base}/today`, label: "今天做什么", icon: LayoutDashboard },
        { href: base, label: "当天行程", icon: Route },
        { href: `${base}/explore`, label: "地图", icon: MapIcon },
      ],
    },
    {
      title: "在地",
      items: [
        { href: `${base}/transport`, label: "交通", icon: Bus },
      ],
    },
    {
      title: "补给",
      items: [
        { href: `${base}/offers`, label: "预订推荐", icon: Ticket },
      ],
    },
  ];
}

export const bottomNav: NavItem[] = [{ href: "/settings", label: "设置", icon: Settings }];
