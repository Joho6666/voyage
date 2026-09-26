import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  Compass,
  LayoutDashboard,
  Map as MapIcon,
  Route,
  Utensils,
  Hotel,
  Sparkles,
  Bus,
  Ticket,
  CheckSquare,
  Wallet,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const globalNav: NavItem[] = [
  { href: "/trips", label: "我的旅行", icon: Route },
  { href: "/new-trip", label: "探索", icon: Compass },
  { href: "/trips?tab=saved", label: "收藏", icon: Bookmark },
];

export interface NavGroupDef {
  title: string;
  items: NavItem[];
}

/** Trip navigation grouped by traveler mental model: planning → on-the-ground → support. */
export function tripNavGroups(tripId: string): NavGroupDef[] {
  const base = `/trip/${tripId}`;
  return [
    {
      title: "规划",
      items: [
        { href: `${base}/today`, label: "总览", icon: LayoutDashboard },
        { href: base, label: "行程", icon: Route },
        { href: `${base}/explore`, label: "地图", icon: MapIcon },
      ],
    },
    {
      title: "在地",
      items: [
        { href: `${base}/hotels`, label: "住宿", icon: Hotel },
        { href: `${base}/food`, label: "美食", icon: Utensils },
        { href: `${base}/activities`, label: "活动", icon: Sparkles },
        { href: `${base}/transport`, label: "交通", icon: Bus },
      ],
    },
    {
      title: "补给",
      items: [
        { href: `${base}/offers`, label: "预订推荐", icon: Ticket },
        { href: `${base}/tasks`, label: "任务", icon: CheckSquare },
        { href: `${base}/budget`, label: "预算", icon: Wallet },
      ],
    },
  ];
}

export const bottomNav: NavItem[] = [{ href: "/settings", label: "设置", icon: Settings }];
