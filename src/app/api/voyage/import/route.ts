import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { guestWorkspace, setGuestCookie } from "../workspace";

export async function POST(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null) as { tripId?: string } | null;
  if (!body?.tripId || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.tripId)) return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const original = await new JsonSkillRepository(workspace.base).getTrip(body.tripId);
  if (!original) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  const guest = new JsonSkillRepository(workspace.root);
  const existing = await guest.getTrip(body.tripId);
  const stored = existing ?? await guest.createTrip(original.trip);
  return setGuestCookie(NextResponse.json({ ok: true, trip: stored.trip, revision: stored.revision }), workspace);
}
