import React from "react";
import type { JourneyMarker } from "../models/marker-model";
import { cn } from "@/lib/utils";

export function PlaceMarker({
  marker,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  marker: JourneyMarker;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const { variant, title, number, time, color, isSelected } = marker;

  if (variant === "NEXT") {
    return (
      <div
        data-testid="place-marker"
        data-place-id={marker.placeId}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="cursor-pointer select-none transition-transform duration-200 hover:scale-105"
        style={{ zIndex: 120 }}
      >
        <div className="flex items-center gap-1.5 rounded-full border-2 border-white bg-primary px-2.5 py-1 text-white shadow-lg ring-4 ring-primary/20">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-white" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/90">NEXT</span>
          <span className="text-[12px] font-semibold">
            {number ? `${number}. ` : ""}
            {title}
          </span>
          {marker.duration ? (
            <span className="text-[11px] text-white/80">· {marker.duration}m</span>
          ) : null}
        </div>
      </div>
    );
  }

  if (variant === "SELECTED") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="cursor-pointer select-none transition-transform duration-200"
        style={{ zIndex: 150 }}
      >
        <div
          className="flex items-center gap-2 rounded-full border-2 border-white bg-surface px-3 py-1.5 text-foreground shadow-xl ring-2"
          style={{ borderColor: "#fff", boxShadow: `0 0 0 2px ${color}` }}
        >
          <div
            className="grid size-5 place-items-center rounded-full text-[11px] font-bold text-white shadow-xs"
            style={{ background: color }}
          >
            {number ?? "·"}
          </div>
          <div className="flex flex-col text-left">
            <span className="text-[12px] font-semibold leading-tight text-foreground truncate max-w-[140px]">
              {title}
            </span>
            {time ? <span className="text-[10px] text-muted-foreground leading-none">{time}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "HOVERED") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="cursor-pointer select-none transition-all duration-150 scale-105"
        style={{ zIndex: 110 }}
      >
        <div className="flex items-center gap-1.5 rounded-full border border-border/80 bg-surface/95 px-2.5 py-1 text-foreground shadow-md backdrop-blur-xs">
          <div
            className="grid size-4.5 place-items-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: color }}
          >
            {number ?? "·"}
          </div>
          <span className="text-[12px] font-medium truncate max-w-[120px]">{title}</span>
        </div>
      </div>
    );
  }

  if (variant === "COMPLETED") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="grid size-6 place-items-center rounded-full border-2 border-white bg-muted text-[11px] font-bold text-muted-foreground opacity-70 transition-transform duration-150 hover:opacity-100 hover:scale-110"
        aria-label={`已打卡: ${title}`}
      >
        ✓
      </div>
    );
  }

  if (variant === "HOTEL") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="grid size-7 place-items-center rounded-full border-2 border-white bg-blue-600 text-white shadow-md transition-transform duration-150 hover:scale-110"
        aria-label={`酒店: ${title}`}
      >
        <span className="text-[11px] font-bold">H</span>
      </div>
    );
  }

  if (variant === "FOOD") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="grid size-6 place-items-center rounded-full border-2 border-white bg-amber-600 text-white shadow-sm transition-transform duration-150 hover:scale-110"
        aria-label={`餐饮: ${title}`}
      >
        <span className="text-[11px]">🍽</span>
      </div>
    );
  }

  if (variant === "TRANSPORT") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="grid size-6 place-items-center rounded-full border-2 border-white bg-teal-600 text-white shadow-sm transition-transform duration-150 hover:scale-110"
        aria-label={`交通枢纽: ${title}`}
      >
        <span className="text-[11px]">🚇</span>
      </div>
    );
  }

  if (variant === "EXPLORE") {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={cn(
          "size-3 rounded-full border-2 border-white shadow-xs transition-transform duration-150 hover:scale-150",
          isSelected && "scale-150 ring-2 ring-primary ring-offset-1",
        )}
        style={{ background: color }}
        aria-label={title}
      />
    );
  }

  // DEFAULT
  return (
    <div
      data-testid="place-marker"
      data-place-id={marker.placeId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "grid size-6 place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-sm transition-transform duration-150 hover:scale-115 active:scale-95",
        isSelected && "scale-125 ring-2 ring-primary ring-offset-1",
      )}
      style={{ background: color }}
      aria-label={title}
    >
      {number ?? "·"}
    </div>
  );
}

/**
 * Generate lightweight HTML string for AMap marker overlay.
 */
export function getMarkerHtml(marker: JourneyMarker): string {
  const { variant, title, number, time, color, isSelected } = marker;

  if (variant === "NEXT") {
    return `
      <div class="voyage-marker-next" style="display:flex;align-items:center;gap:6px;background:#10b981;color:#fff;padding:4px 10px;border-radius:999px;border:2px solid #fff;box-shadow:0 10px 15px -3px rgba(16,185,129,0.3);font-family:system-ui,-apple-system,sans-serif;white-space:nowrap;cursor:pointer;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:#fff;"></span>
        <span style="font-size:10px;font-weight:700;letter-spacing:0.5px;opacity:0.9;">NEXT</span>
        <span style="font-size:12px;font-weight:600;">${number ? number + ". " : ""}${escapeHtml(title)}</span>
      </div>
    `;
  }

  if (variant === "SELECTED") {
    return `
      <div class="voyage-marker-selected" style="display:flex;align-items:center;gap:8px;background:#ffffff;color:#18181b;padding:4px 10px;border-radius:999px;border:2px solid ${color};box-shadow:0 10px 20px -3px rgba(0,0,0,0.18);font-family:system-ui,-apple-system,sans-serif;white-space:nowrap;cursor:pointer;transform:scale(1.05);">
        <div style="width:20px;height:20px;border-radius:999px;background:${color};color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;">${number ?? "·"}</div>
        <div style="display:flex;flex-direction:column;">
          <span style="font-size:12px;font-weight:600;line-height:1.2;">${escapeHtml(title)}</span>
          ${time ? `<span style="font-size:10px;color:#71717a;line-height:1;">${time}</span>` : ""}
        </div>
      </div>
    `;
  }

  if (variant === "HOVERED") {
    return `
      <div class="voyage-marker-hover" style="display:flex;align-items:center;gap:6px;background:#ffffff;color:#18181b;padding:3px 8px;border-radius:999px;border:1.5px solid #e4e4e7;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);font-family:system-ui,-apple-system,sans-serif;white-space:nowrap;cursor:pointer;">
        <div style="width:18px;height:18px;border-radius:999px;background:${color};color:#fff;font-size:10px;font-weight:600;display:grid;place-items:center;">${number ?? "·"}</div>
        <span style="font-size:11px;font-weight:500;">${escapeHtml(title)}</span>
      </div>
    `;
  }

  if (variant === "COMPLETED") {
    return `
      <div class="voyage-marker-completed" style="width:22px;height:22px;border-radius:999px;background:#e4e4e7;color:#71717a;font-size:11px;font-weight:700;display:grid;place-items:center;border:2px solid #fff;opacity:0.7;cursor:pointer;">✓</div>
    `;
  }

  if (variant === "HOTEL") {
    return `
      <div class="voyage-marker-hotel" style="width:26px;height:26px;border-radius:999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.15);cursor:pointer;">H</div>
    `;
  }

  if (variant === "FOOD") {
    return `
      <div class="voyage-marker-food" style="width:24px;height:24px;border-radius:999px;background:#ea580c;color:#fff;font-size:11px;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.1);cursor:pointer;">🍽</div>
    `;
  }

  if (variant === "TRANSPORT") {
    return `
      <div class="voyage-marker-transport" style="width:24px;height:24px;border-radius:999px;background:#0d9488;color:#fff;font-size:11px;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.1);cursor:pointer;">🚇</div>
    `;
  }

  if (variant === "EXPLORE") {
    return `
      <div class="voyage-marker-explore" style="width:12px;height:12px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);cursor:pointer;${isSelected ? "transform:scale(1.4);" : ""}"></div>
    `;
  }

  // DEFAULT
  return `
    <div class="voyage-marker-default" style="width:24px;height:24px;border-radius:999px;background:${color};color:#fff;font:600 11px/24px system-ui,-apple-system,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.15);cursor:pointer;">${number ?? "·"}</div>
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
