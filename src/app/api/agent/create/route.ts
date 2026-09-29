import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { SkillError } from "@/skill/errors";
import { createTripWebRequestSchema, planTripFromRequest } from "@/services/trip-planner/create-trip";
import { guestWorkspace, setGuestCookie } from "@/app/api/voyage/workspace";
import { enforceRateLimit } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

function statusFor(error: SkillError) {
  if (error.code === "INVALID_INPUT") return 400;
  if (
    error.code === "NO_PROVIDER_CONFIGURED" ||
    error.code === "PROVIDER_AUTH_FAILED" ||
    error.code === "AMAP_NETWORK_UNAVAILABLE" ||
    error.code === "NO_POI_RESULTS" ||
    error.code === "WEATHER_UNAVAILABLE" ||
    error.code === "ROUTE_PROVIDER_UNAVAILABLE"
  ) return 503;
  return 409;
}

export async function POST(request: NextRequest) {
  const workspace = guestWorkspace(request);
  // Creating a trip runs the full paid pipeline (AMap x6, weather, social,
  // LLM, offers) — same budget class as the planning-session generate route.
  const limited = enforceRateLimit(request, "planning");
  if (limited) return setGuestCookie(limited, workspace);
  const reply = (body: unknown, status = 200) => setGuestCookie(
    NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }),
    workspace,
  );
  const body = createTripWebRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return reply({ error: "invalid body", detail: body.error.flatten() }, 400);
  }

  try {
    const planned = await planTripFromRequest(body.data, workspace.root);
    return reply(planned);
  } catch (error) {
    if (error instanceof SkillError) {
      return reply({ error: error.code, detail: error.message }, statusFor(error));
    }
    return reply({ error: "INTERNAL_ERROR", detail: "Voyage runtime failed" }, 500);
  }
}
