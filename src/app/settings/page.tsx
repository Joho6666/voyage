"use client";

import { AppFrame } from "@/components/layout/AppFrame";
import { brand } from "@/lib/brand";
import { createMapProvider } from "@/services/map/amap";

export default function SettingsPage() {
  const map = createMapProvider();
  return (
    <AppFrame>
      <div className="mx-auto max-w-xl px-6 py-10">
        <h1 className="text-2xl font-medium">设置</h1>
        <dl className="mt-6 space-y-4 text-sm">
          <Row label="产品" value={`${brand.name} · ${brand.product}`} />
          <Row label="地图" value={map.label} />
          <Row label="AI" value="MockTravelAgent（无 Key 可完整运行）" />
          <Row label="预订" value="MockBookingProvider" />
        </dl>
      </div>
    </AppFrame>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
