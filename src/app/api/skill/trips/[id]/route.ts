import { NextRequest, NextResponse } from "next/server";
import { guestWorkspace, setGuestCookie } from "@/app/api/voyage/workspace";
import { JsonSkillRepository } from "@/skill/repository";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const workspace = guestWorkspace(request);
  const reply = (body: unknown, status = 200) => setGuestCookie(
    NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }),
    workspace,
  );
  const { id } = await context.params;
  const stored = await new JsonSkillRepository(workspace.root).getTrip(id);
  if (!stored) return reply({ ok: false, error: "TRIP_NOT_FOUND" }, 404);
  return reply({ ok: true, ...stored });
}
