import { NextResponse } from "next/server";
import { z } from "zod";
import { amapSearchPois, isAmapConfigured } from "@/services/map/amap-rest";

const querySchema = z.object({
  city: z.string().min(1).max(40),
  keywords: z.string().min(1).max(40),
});

export async function GET(request: Request) {
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
    return NextResponse.json(
      { source: "mock", pois: [], error: error instanceof Error ? error.message : "poi search failed" },
      { status: 200 },
    );
  }
}
