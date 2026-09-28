import { describe, expect, it } from "vitest";
import { weatherDisplay } from "@/lib/weather-display";
import { weatherForDate } from "@/services/weather/merge";
import type { Day } from "@/types/travel";

function dayWeather(weather: Day["weather"]): Day["weather"] {
  return weather;
}

describe("weatherDisplay", () => {
  it("never shows a temperature for the unavailable sentinel", () => {
    // This is the exact value weatherForDate produces for dates with no forecast.
    const sentinel = dayWeather(weatherForDate([], "2030-05-01"));
    const display = weatherDisplay(sentinel);
    expect(display.known).toBe(false);
    expect(display.text).not.toContain("°C");
    expect(display.text).not.toContain("0");
    expect(display.text).toContain("天气未知");
  });

  it("renders a real forecast with its temperature", () => {
    const display = weatherDisplay(dayWeather({
      tempC: 24, condition: "多云", icon: "cloud",
      provenance: { source: "amap", estimated: false },
    }));
    expect(display).toEqual({ text: "24°C 多云", known: true });
  });

  it("treats legacy records without provenance as known when the condition is real", () => {
    const display = weatherDisplay(dayWeather({ tempC: 21, condition: "小雨", icon: "rain" }));
    expect(display).toEqual({ text: "21°C 小雨", known: true });
  });

  it("still hides the temperature when condition says unknown but provenance is missing", () => {
    const display = weatherDisplay(dayWeather({ tempC: 0, condition: "天气未知", icon: "overcast" }));
    expect(display.known).toBe(false);
    expect(display.text).not.toContain("°C");
  });

  it("handles a missing weather object without crashing", () => {
    expect(weatherDisplay(undefined)).toEqual({ text: "天气未知", known: false });
  });
});
