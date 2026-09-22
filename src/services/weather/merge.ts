import type { DataProvenance } from "@/types/travel";

export interface ForecastRecord {
  date: string;
  tempC: number;
  condition: string;
  icon: "sun" | "cloud" | "rain" | "overcast";
}

export function weatherForDate(forecasts: ForecastRecord[], date: string, fetchedAt = new Date().toISOString()) {
  const forecast = forecasts.find((item) => item.date === date);
  if (!forecast) {
    return {
      tempC: 0,
      condition: "天气未知",
      icon: "overcast" as const,
      provenance: { source: "unavailable", estimated: true, reason: "NO_FORECAST_FOR_DATE" } satisfies DataProvenance,
    };
  }
  return {
    tempC: forecast.tempC,
    condition: forecast.condition,
    icon: forecast.icon,
    fetchedAt,
    provenance: { source: "amap", estimated: false } satisfies DataProvenance,
  };
}
