"use client";

import React from "react";
import {
  CheckCircle2,
  CloudDownload,
  Compass,
  Layers,
  Loader2,
  LocateFixed,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MapLayersConfig } from "../models/map-state";
import { cn } from "@/lib/utils";

export function MapToolbar({
  onLocate,
  onFitDay,
  onFitTrip,
  onZoomIn,
  onZoomOut,
  onRecenter,
  userInteracted,
  layers,
  onToggleLayer,
  activeDayTitle,
  isOnline = true,
  isCached = false,
  isCaching = false,
  onCacheTrip,
}: {
  onLocate: () => void;
  onFitDay: () => void;
  onFitTrip: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onRecenter: () => void;
  userInteracted: boolean;
  layers: MapLayersConfig;
  onToggleLayer: (key: keyof MapLayersConfig) => void;
  activeDayTitle?: string;
  isOnline?: boolean;
  isCached?: boolean;
  isCaching?: boolean;
  onCacheTrip?: () => void;
}) {
  return (
    <>
      {/* Offline Mode Indicator */}
      {!isOnline ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-50/95 dark:bg-amber-950/90 px-3.5 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200 shadow-md backdrop-blur-xs animate-in fade-in duration-200">
          <WifiOff className="size-3.5 text-amber-600 shrink-0" />
          <span>离线模式生效中 · 本地轨迹与路线就绪</span>
        </div>
      ) : null}

      {/* Floating "重新居中" button when user manually panned/zoomed */}
      {userInteracted && isOnline ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 animate-in fade-in slide-in-from-top-2 duration-200">
          <button
            type="button"
            onClick={onRecenter}
            className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-surface/95 px-3.5 py-1.5 text-[12px] font-medium text-primary shadow-lg backdrop-blur-xs transition-transform hover:scale-105 active:scale-95 hover:bg-surface"
          >
            <RotateCcw className="size-3.5" />
            <span>重新居中{activeDayTitle ? ` · ${activeDayTitle}` : ""}</span>
          </button>
        </div>
      ) : null}

      {/* Main Toolbar */}
      <div className="absolute right-3.5 top-3.5 z-20 flex flex-col gap-1.5 select-none">
        {/* Locate */}
        <ToolbarButton onClick={onLocate} title="我的位置">
          <LocateFixed className="size-4" />
        </ToolbarButton>

        {/* Fit Active Day */}
        <ToolbarButton onClick={onFitDay} title="聚焦今日">
          <Compass className="size-4" />
        </ToolbarButton>

        {/* Fit Whole Trip */}
        <ToolbarButton onClick={onFitTrip} title="全行程范围">
          <Maximize2 className="size-4" />
        </ToolbarButton>

        {/* Offline Journey Cache */}
        {onCacheTrip ? (
          <ToolbarButton
            onClick={onCacheTrip}
            title={
              isCaching
                ? "正在生成离线包..."
                : isCached
                  ? "离线包就绪（点击重新缓存）"
                  : "下载行程离线包"
            }
            className={cn(
              isCached && "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
              !isOnline && "border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
            )}
          >
            {isCaching ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : !isOnline ? (
              <WifiOff className="size-4 text-amber-600" />
            ) : isCached ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <CloudDownload className="size-4 text-muted-foreground" />
            )}
          </ToolbarButton>
        ) : null}

        {/* Layer Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-[10px] border border-border/80 bg-surface/90 text-foreground shadow-sm backdrop-blur-xs transition-all hover:bg-secondary active:scale-95"
              title="图层控制"
            >
              <Layers className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel className="text-[12px] text-muted-foreground">
              地图图层
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={layers.trip}
              onCheckedChange={() => onToggleLayer("trip")}
              className="text-[13px]"
            >
              行程路线与地点
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={layers.hotel}
              onCheckedChange={() => onToggleLayer("hotel")}
              className="text-[13px]"
            >
              住宿酒店
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={layers.food}
              onCheckedChange={() => onToggleLayer("food")}
              className="text-[13px]"
            >
              餐饮美食
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={layers.transport}
              onCheckedChange={() => onToggleLayer("transport")}
              className="text-[13px]"
            >
              交通枢纽
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={layers.explore}
              onCheckedChange={() => onToggleLayer("explore")}
              className="text-[13px]"
            >
              探索 POI
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Zoom In & Out */}
        {onZoomIn && onZoomOut ? (
          <div className="mt-1 flex flex-col gap-1">
            <ToolbarButton onClick={onZoomIn} title="放大">
              <Plus className="size-4" />
            </ToolbarButton>
            <ToolbarButton onClick={onZoomOut} title="缩小">
              <Minus className="size-4" />
            </ToolbarButton>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ToolbarButton({
  children,
  onClick,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "grid size-9 place-items-center rounded-[10px] border border-border/80 bg-surface/90 text-foreground shadow-sm backdrop-blur-xs transition-all hover:bg-secondary active:scale-95",
        className,
      )}
    >
      {children}
    </button>
  );
}
