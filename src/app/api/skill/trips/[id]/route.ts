import path from "node:path";
import { NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const root = process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage");
  const stored = await new JsonSkillRepository(root).getTrip(id);
  if (!stored) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, ...stored });
}
