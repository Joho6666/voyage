import "server-only";

import { createTripWebRequestSchema, planTripFromRequest } from "@/services/trip-planner/create-trip";
import { tripRepository } from "@/services/trips/repository";
import { persistSocialSearch } from "@/services/social/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = createTripWebRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid body", detail: body.error.flatten() }, { status: 400 });
  }

  let source: "llm" | "rules";
  let mapProvider: "amap" | "demo";
  let trip;
  let social;
  try {
    const planned = await planTripFromRequest(body.data);
    source = planned.source;
    mapProvider = planned.mapProvider;
    trip = planned.trip;
    social = planned.social;
  } catch (error) {
    const message = error instanceof Error ? error.message : "candidate lookup failed";
    const errorCode = /INVALID_USER_KEY|USERKEY_PLAT_NOMATCH/.test(message)
      ? "AMAP_INVALID_USER_KEY"
      : message === "NO_POI_RESULTS"
        ? "NO_POI_RESULTS"
        : message === "NO_PROVIDER_CONFIGURED"
          ? "NO_PROVIDER_CONFIGURED"
          : "AMAP_PROVIDER_ERROR";
    return Response.json(
      { error: errorCode, detail: errorCode === "AMAP_INVALID_USER_KEY" ? "AMAP_SERVER_KEY 无效、未开通 Web 服务或 Key 与平台类型不匹配" : message },
      { status: 503 },
    );
  }

  if (social) {
    void persistSocialSearch(social).catch(() => undefined);
  }

  try {
    const saved = await tripRepository.save(trip);
    return Response.json({ source, mapProvider, trip: saved });
  } catch (error) {
    return Response.json(
      {
        source,
        mapProvider,
        trip,
        persistError: error instanceof Error ? error.message : "persist failed",
      },
      { status: 200 },
    );
  }
}
