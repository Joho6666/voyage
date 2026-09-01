import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatCny(amount: number) {
  return `¥${amount.toLocaleString("zh-CN")}`;
}

export function formatKm(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

export function weekdayZh(isoDate: string) {
  const days = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const date = new Date(`${isoDate}T12:00:00`);
  return days[date.getDay()] ?? "";
}

export function formatShortDate(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function formatMonthDay(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function nightCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

export function dayCount(startDate: string, endDate: string) {
  return nightCount(startDate, endDate) + 1;
}

export function tripDurationLabel(startDate: string, endDate: string) {
  const days = dayCount(startDate, endDate);
  const nights = nightCount(startDate, endDate);
  return `${days} 天 ${nights} 夜`;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateTransit(meters: number): {
  mode: "walk" | "metro" | "taxi";
  minutes: number;
  label: string;
} {
  if (meters < 700) {
    const minutes = Math.max(4, Math.round(meters / 80));
    return { mode: "walk", minutes, label: "步行" };
  }
  if (meters < 8000) {
    const minutes = Math.max(12, Math.round(meters / 280 + 8));
    return { mode: "metro", minutes, label: "地铁" };
  }
  const minutes = Math.max(18, Math.round(meters / 420 + 6));
  return { mode: "taxi", minutes, label: "出租" };
}
