import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import { JsonSkillRepository } from "@/skill/repository";
import { authorizeTripImport, guestWorkspace, setGuestCookie } from "../workspace";

export async function POST(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const reply = (body: unknown, status = 200) => setGuestCookie(
    NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }),
    workspace,
  );
  const body = await request.json().catch(() => null) as { tripId?: string } | null;
  if (!body?.tripId || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.tripId)) return reply({ ok: false, error: "INVALID_INPUT" }, 400);

  const guest = new JsonSkillRepository(workspace.root);
  const existing = await guest.getTrip(body.tripId);
  const authorization = authorizeTripImport({
    tripId: body.tripId,
    workspaceTripExists: Boolean(existing),
    demoMode: process.env.VOYAGE_DEMO_MODE,
    publicDemoTripIds: [DEMO_TRIP_ID],
  });
  if (authorization === "workspace" && existing) {
    return reply({ ok: true, trip: existing.trip, revision: existing.revision });
  }
  if (authorization !== "public-demo" || body.tripId !== DEMO_TRIP_ID) {
    return reply({ ok: false, error: "TRIP_NOT_FOUND" }, 404);
  }

  const stored = await guest.createTrip(structuredClone(chongqingTrip));
  return reply({ ok: true, trip: stored.trip, revision: stored.revision });
}
