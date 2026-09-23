import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { NextRequest } from "next/server";
import { guestWorkspace, setGuestCookie } from "../workspace";

const root = () => process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage");

export async function POST(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null) as { tripId?: string } | null;
  if (!body?.tripId) return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const stored = await new JsonSkillRepository(workspace.root).getTrip(body.tripId);
  if (!stored) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  const token = randomUUID();
  await mkdir(path.join(root(), "shares"), { recursive: true });
  await writeFile(path.join(root(), "shares", `${token}.json`), JSON.stringify({ token, trip: stored.trip, expiresAt: Date.now() + 7 * 86400000 }), "utf8");
  return setGuestCookie(NextResponse.json({ ok: true, token, expiresAt: Date.now() + 7 * 86400000 }), workspace);
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  try {
    const share = JSON.parse(await readFile(path.join(root(), "shares", `${token}.json`), "utf8")) as { trip: import("@/types/travel").Trip; expiresAt: number };
    if (share.expiresAt < Date.now()) return NextResponse.json({ ok: false, error: "SHARE_EXPIRED" }, { status: 410 });
    return NextResponse.json({ ok: true, trip: share.trip });
  } catch {
    return NextResponse.json({ ok: false, error: "SHARE_NOT_FOUND" }, { status: 404 });
  }
}
