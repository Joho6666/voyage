import { NextResponse } from "next/server";
import { z } from "zod";
import { amapSearchPois, isAmapConfigured } from "@/services/map/amap-rest";
import { failureMessage } from "@/lib/failure-message";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";

const querySchema = z.object({
  city: z.string().min(1).max(40),
  keywords: z.string().min(1).max(40),
});

export async function GET(request: Request) {
  // Paid providers behind this route share one budget per caller.
  const limited = enforceRateLimit(request, "amap");
  if (limited) return limited;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    city: url.searchParams.get("city") ?? "",
    keywords: url.searchParams.get("keywords") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "city and keywords required" }, { status: 400 });
  }
  if (!isAmapConfigured()) {
    return NextResponse.json({ source: "mock", pois: [] });
  }
  try {
    const pois = await amapSearchPois({
      city: parsed.data.city,
      keywords: parsed.data.keywords,
      offset: 16,
    });
    return NextResponse.json({ source: "amap", pois });
  } catch (error) {
    logger.warn("amap-poi.degraded_to_mock", { reason: failureMessage(error, "poi search failed") });
    return NextResponse.json(
      { source: "mock", pois: [], error: failureMessage(error, "poi search failed") },
      { status: 200 },
    );
  }
}
