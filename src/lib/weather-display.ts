import type { Day } from "@/types/travel";

export interface WeatherDisplay {
  /** Rendered text without any temperature when the weather is unknown. */
  text: string;
  /** False when the weather is the "unavailable" sentinel and must not show a temperature. */
  known: boolean;
}

/**
 * Weather comes back as a 0°C "天气未知" sentinel for dates outside the
 * forecast range. Rendering the raw value produced a plausible-looking but
 * wrong "0°C" — exactly the fake-data display this product forbids — so every
 * consumer must go through here instead of reading tempC directly.
 */
export function weatherDisplay(weather: Day["weather"] | undefined): WeatherDisplay {
  if (!weather) return { text: "天气未知", known: false };
  const known = weather.provenance?.source !== "unavailable" && weather.condition !== "天气未知";
  if (!known) return { text: weather.condition || "天气未知", known: false };
  return { text: `${weather.tempC}°C ${weather.condition}`, known: true };
}
