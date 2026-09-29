import { NextResponse } from "next/server";
import { z } from "zod";
import { amapGeocode, amapWeather, isAmapConfigured } from "@/services/map/amap-rest";
import type { WeatherDay } from "@/services/weather/types";
import { failureMessage } from "@/lib/failure-message";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";

const querySchema = z.object({
  city: z.string().min(1).max(40),
});

function iconFrom(text: string): WeatherDay["icon"] {
  if (text.includes("雨")) return "rain";
  if (text.includes("云")) return "cloud";
  if (text.includes("阴")) return "overcast";
  return "sun";
}

export async function GET(request: Request) {
  // Paid providers behind this route share one budget per caller.
  const limited = enforceRateLimit(request, "amap");
  if (limited) return limited;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ city: url.searchParams.get("city") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "city required" }, { status: 400 });
  }
  if (!isAmapConfigured()) {
    return NextResponse.json({ source: "mock", days: [] });
  }
  try {
    const geo = await amapGeocode(parsed.data.city, parsed.data.city);
    const casts = await amapWeather(geo.adcode || parsed.data.city);
    const days: WeatherDay[] = casts.map((cast) => ({
      date: cast.date,
      tempC: Math.round((cast.dayTemp + cast.nightTemp) / 2) || cast.dayTemp,
      condition: cast.dayWeather,
      icon: iconFrom(cast.dayWeather),
    }));
    return NextResponse.json({ source: "amap", days });
  } catch (error) {
    logger.warn("weather.degraded_to_mock", { reason: failureMessage(error, "weather failed") });
    return NextResponse.json(
      { source: "mock", days: [], error: failureMessage(error, "weather failed") },
      { status: 200 },
    );
  }
}
