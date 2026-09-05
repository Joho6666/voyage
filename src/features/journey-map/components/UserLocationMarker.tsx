import React from "react";
import type { UserLocation } from "../models/map-state";

export function UserLocationMarker({ location }: { location?: UserLocation }) {
  return (
    <div
      className="relative flex size-6 items-center justify-center -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      title={location ? `定位更新: ${new Date(location.updatedAt).toLocaleTimeString()}` : "当前位置"}
    >
      <span className="absolute inline-flex size-6 animate-ping rounded-full bg-blue-500 opacity-60" />
      <span className="relative inline-flex size-3.5 rounded-full border-2 border-white bg-blue-600 shadow-md" />
    </div>
  );
}

export function getUserLocationHtml(): string {
  return `
    <div class="voyage-user-location" style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
      <div style="position:absolute;width:24px;height:24px;border-radius:999px;background:#3b82f6;opacity:0.4;animation:voyagePulse 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="width:14px;height:14px;border-radius:999px;background:#2563eb;border:2.5px solid #ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.25);"></div>
    </div>
    <style>
      @keyframes voyagePulse {
        0% { transform: scale(0.6); opacity: 0.8; }
        70% { transform: scale(1.6); opacity: 0; }
        100% { transform: scale(1.6); opacity: 0; }
      }
    </style>
  `;
}
