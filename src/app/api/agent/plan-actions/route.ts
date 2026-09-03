import { NextResponse } from "next/server";
import { z } from "zod";
import { planActions } from "@/services/ai/actions/planner";
import { executeActions } from "@/services/ai/actions/executor";
import { tripRepository } from "@/services/trips/repository";
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
  const trip = body.data.trip as unknown as Trip;
  const { source, result } = await planActions(trip, body.data.message);
  const execution = executeActions(trip, result.actions);
  const nextTrip = recomputeTrip(execution.trip);

  if (body.data.persist !== false) {
    try {
      await tripRepository.save(nextTrip);
    } catch (error) {
      return NextResponse.json(
        { source, summary: result.summary, actions: result.actions, applied: execution.applied, rejected: execution.rejected, trip: nextTrip, persistError: error instanceof Error ? error.message : "persist failed" },
        { status: 200 },
      );
    }
  }

  return NextResponse.json({
    source,
    summary: result.summary,
    actions: result.actions,
    applied: execution.applied,
    rejected: execution.rejected,
    trip: nextTrip,
  });
}

export function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
