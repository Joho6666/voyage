import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { JsonSkillRepository, type StoredTrip } from "@/skill/repository";
import { guestWorkspace, setGuestCookie } from "../workspace";
import { resolveCityCoverImage } from "@/services/media/city-cover";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";
import type { TripStatus } from "@/types/travel";

/** The list page only ever reads these fields — stop shipping full trip
 * objects (segments, offers, social evidence) to render a card grid. */
function tripSummary(record: StoredTrip) {
  return {
    id: record.trip.id,
    title: record.trip.title,
    destination: record.trip.destination,
    startDate: record.trip.startDate,
    endDate: record.trip.endDate,
    travelers: record.trip.travelers,
    budget: record.trip.budget,
    coverImage: record.trip.coverImage,
    status: record.trip.status ?? ("ready" as TripStatus),
    createdAt: record.trip.createdAt,
    revision: record.revision,
  };
}

/** Cover backfill used to run inline and block this response on Wikipedia
 * (up to ~10s per cover-less trip). Detached now: this response serves
 * whatever exists (the UI has a gradient fallback) and the next visit picks
 * up any newly filled cover. */
function backfillCoversDetached(repository: JsonSkillRepository, records: StoredTrip[]) {
  void Promise.all(records.filter((record) => !record.trip.coverImage).map(async (record) => {
    const coverImage = await resolveCityCoverImage(record.trip.destination, record.trip.places).catch(() => "");
    if (!coverImage) return;
    await repository.updateTrip({
      tripId: record.trip.id,
      expectedRevision: record.revision,
      trip: { ...record.trip, coverImage, updatedAt: new Date().toISOString() },
    }).catch(() => undefined);
  }));
}

export async function GET(request: NextRequest) {
  // The list is read-cheap now, but a detached cover backfill (outbound
  // Wikipedia request + disk write per cover-less trip) still rides along, so
  // a tight loop on this endpoint must not be free.
  const limited = enforceRateLimit(request, "read");
  if (limited) return setGuestCookie(limited, guestWorkspace(request));
  const workspace = guestWorkspace(request);
  const repository = new JsonSkillRepository(workspace.root);
  const records = await repository.listTrips();
  backfillCoversDetached(repository, records);
  return setGuestCookie(NextResponse.json({ ok: true, trips: records.map(tripSummary) }, { headers: { "cache-control": "no-store" } }), workspace);
}

export async function DELETE(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null) as { tripId?: string } | null;
  if (!body?.tripId) return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try { await new JsonSkillRepository(workspace.root).deleteTrip(body.tripId); }
  catch (error) {
    logger.warn("trips.delete_failed", { tripId: body.tripId, error });
    return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
