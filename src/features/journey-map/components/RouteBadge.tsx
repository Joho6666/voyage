import React from "react";
import type { RouteBadge } from "../models/route-model";
import { cn } from "@/lib/utils";

export function RouteBadgeComponent({
  badge,
  onClick,
}: {
  badge: RouteBadge;
  onClick?: () => void;
}) {
  const { label, isReal, state } = badge;
  const isActive = state === "ACTIVE";

  return (
    <div
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border bg-surface/95 px-2.5 py-0.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-xs transition-all hover:scale-105 hover:bg-surface active:scale-95",
        isActive
          ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20 shadow-md font-semibold"
          : "border-border/80 text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full shrink-0",
          isReal ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-amber-500/80",
        )}
        title={isReal ? "高德实时路线" : "预估路线"}
      />
      <span>{label}</span>
    </div>
  );
}

/**
 * Generate lightweight HTML string for AMap marker overlay representing the route capsule.
 */
export function getRouteBadgeHtml(badge: RouteBadge): string {
  const { label, isReal, state } = badge;
  const isActive = state === "ACTIVE";

  const borderColor = isActive ? "#0284c7" : "#e4e4e7";
  const bg = isActive ? "#f0f9ff" : "#ffffff";
  const color = isActive ? "#0369a1" : "#3f3f46";
  const dotBg = isReal ? "#10b981" : "#f59e0b";
  const dotGlow = isReal ? "box-shadow:0 0 5px rgba(16,185,129,0.6);" : "";
  const fontWeight = isActive ? "600" : "500";

  return `
    <div class="voyage-route-capsule" style="display:inline-flex;align-items:center;gap:5px;background:${bg};border:1.5px solid ${borderColor};color:${color};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:${fontWeight};font-family:system-ui,-apple-system,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.08);cursor:pointer;white-space:nowrap;user-select:none;">
      <span style="display:inline-block;width:5px;height:5px;border-radius:999px;background:${dotBg};${dotGlow}"></span>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
