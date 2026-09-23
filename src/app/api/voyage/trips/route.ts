import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { guestWorkspace, setGuestCookie } from "../workspace";

export async function GET(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const records = await new JsonSkillRepository(workspace.root).listTrips();
  return setGuestCookie(NextResponse.json({ ok: true, trips: records.map((record) => ({ ...record.trip, revision: record.revision })) }, { headers: { "cache-control": "no-store" } }), workspace);
}

export async function DELETE(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null) as { tripId?: string } | null;
  if (!body?.tripId) return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try { await new JsonSkillRepository(workspace.root).deleteTrip(body.tripId); }
  catch { return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 }); }
  return NextResponse.json({ ok: true });
}
