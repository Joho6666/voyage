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

export function tripNav(tripId: string): NavItem[] {
  const base = `/trip/${tripId}`;
  return [
    { href: `${base}/today`, label: "总览", icon: LayoutDashboard },
    { href: base, label: "行程", icon: Route },
    { href: `${base}/explore`, label: "地图", icon: MapIcon },
    { href: `${base}/hotels`, label: "住宿", icon: Hotel },
    { href: `${base}/food`, label: "美食", icon: Utensils },
    { href: `${base}/activities`, label: "活动", icon: Sparkles },
    { href: `${base}/transport`, label: "交通", icon: Bus },
    { href: `${base}/tasks`, label: "任务", icon: CheckSquare },
    { href: `${base}/budget`, label: "预算", icon: Wallet },
  ];
}

export const bottomNav: NavItem[] = [{ href: "/settings", label: "设置", icon: Settings }];
