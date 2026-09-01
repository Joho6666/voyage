"use client";

import { useTripStore } from "@/store/trip-store";
import { formatCny } from "@/lib/utils";

const LABELS: Record<string, string> = {
  transport: "交通",
  stay: "住宿",
  food: "美食",
  ticket: "景点",
  shop: "购物",
  other: "其他",
};

export default function BudgetPage() {
  const trip = useTripStore((s) => s.trip);
  const remaining = trip.budget - trip.estimatedSpend;
  const max = Math.max(...trip.budgetItems.map((b) => b.planned), 1);

  return (
    <div className="h-full overflow-y-auto p-4 pb-20 scrollbar-thin">
      <h1 className="text-lg font-medium">预算</h1>
      <div className="mt-4 grid grid-cols-3 gap-3 rounded-[14px] border border-border p-4">
        <Metric label="总预算" value={formatCny(trip.budget)} />
        <Metric label="预计" value={formatCny(trip.estimatedSpend)} />
        <Metric label="剩余" value={formatCny(remaining)} />
      </div>
      <div className="mt-6 space-y-3">
        {trip.budgetItems.map((item) => (
          <div key={item.id}>
            <div className="mb-1 flex justify-between text-[13px]">
              <span>{LABELS[item.category] ?? item.label}</span>
              <span className="tabular-nums text-muted-foreground">{formatCny(item.planned)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(item.planned / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
    </div>
  );
}
