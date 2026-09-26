import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { guestWorkspace, setGuestCookie } from "../workspace";
import { resolveCityCoverImage } from "@/services/media/city-cover";

export async function GET(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const repository = new JsonSkillRepository(workspace.root);
  const records = await repository.listTrips();
  const completed = await Promise.all(records.map(async (record) => {
    if (record.trip.coverImage) return record;
    const coverImage = await resolveCityCoverImage(record.trip.destination, record.trip.places).catch(() => "");
    if (!coverImage) return record;
    try {
      return await repository.updateTrip({
        tripId: record.trip.id,
        expectedRevision: record.revision,
        trip: { ...record.trip, coverImage, updatedAt: new Date().toISOString() },
      });
    } catch {
      // Another tab may have filled the cover concurrently; keep the current record.
      return record;
    }
  }));
  return setGuestCookie(NextResponse.json({ ok: true, trips: completed.map((record) => ({ ...record.trip, revision: record.revision })) }, { headers: { "cache-control": "no-store" } }), workspace);
}

export async function DELETE(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null) as { tripId?: string } | null;
  if (!body?.tripId) return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try { await new JsonSkillRepository(workspace.root).deleteTrip(body.tripId); }
  catch { return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 }); }
  return NextResponse.json({ ok: true });
}
