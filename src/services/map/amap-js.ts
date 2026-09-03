"use client";

declare global {
  interface Window {
    AMap?: {
      Map: new (el: HTMLElement, opts: Record<string, unknown>) => AMapInstance;
      Marker: new (opts: Record<string, unknown>) => AMapOverlay;
      Polyline: new (opts: Record<string, unknown>) => AMapOverlay;
      Pixel: new (x: number, y: number) => unknown;
      Size: new (w: number, h: number) => unknown;
    };
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

export interface AMapInstance {
  add: (overlay: unknown) => void;
  remove: (overlay: unknown) => void;
  setFitView: (overlays?: unknown[], immediately?: boolean, avoid?: number[]) => void;
  destroy: () => void;
  setCenter: (lnglat: [number, number]) => void;
  setZoom: (zoom: number) => void;
}

export interface AMapOverlay {
  setMap: (map: AMapInstance | null) => void;
  on: (event: string, handler: () => void) => void;
}

let loading: Promise<void> | null = null;

export function isAmapJsConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_AMAP_KEY);
}

export function loadAmapJs(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("AMap is browser-only"));
  if (window.AMap) return Promise.resolve();
  if (loading) return loading;
  const key = process.env.NEXT_PUBLIC_AMAP_KEY;
  if (!key) return Promise.reject(new Error("NEXT_PUBLIC_AMAP_KEY is not set"));
  const security = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;
  if (security) {
    window._AMapSecurityConfig = { securityJsCode: security };
  }
  loading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-amap]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("AMap script failed")));
      return;
    }
    const script = document.createElement("script");
    script.dataset.amap = "1";
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("AMap script failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
