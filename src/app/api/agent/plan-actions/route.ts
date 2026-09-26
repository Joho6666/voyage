import { NextResponse } from "next/server";
import { z } from "zod";
import { planActions } from "@/services/ai/actions/planner";
import { executeActions } from "@/services/ai/actions/executor";
import { computeTripChangeSet } from "@/services/ai/diff";
import { recomputeTrip } from "@/services/routing";
import type { Trip } from "@/types/travel";

const bodySchema = z.object({
  trip: z.object({ id: z.string().min(1) }).passthrough(),
  message: z.string().min(1).max(2000),
  persist: z.boolean().optional(),
});

export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (body.data.persist === true) {
    return NextResponse.json(
      {
        error: "CONFIRMATION_REQUIRED",
        detail: "This endpoint only previews a change. Use propose-change, then apply-change with confirmed=true.",
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  const trip = body.data.trip as unknown as Trip;
  const { source, result } = await planActions(trip, body.data.message);
  const execution = executeActions(trip, result.actions);
  const nextTrip = recomputeTrip(execution.trip);

  // This legacy endpoint is preview-only. Persistence must go through the
  // workspace-scoped runtime proposal and explicit apply-change command.
  return NextResponse.json({
    source,
    summary: result.summary,
    actions: result.actions,
    applied: execution.applied,
    rejected: execution.rejected,
    trip: nextTrip,
    changeSet: computeTripChangeSet(trip, nextTrip, execution.applied, result.summary),
    requiresConfirmation: true,
  }, { headers: { "cache-control": "no-store" } });
}

export function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
