import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { NextRequest, NextResponse } from "next/server";

const cookieName = "voyage_guest_workspace";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function guestWorkspace(request: NextRequest) {
  const existing = request.cookies.get(cookieName)?.value;
  const id = existing && uuid.test(existing) ? existing : randomUUID();
  const base = process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage");
  return { id, fresh: id !== existing, root: path.join(base, "guests", id), base };
}

export function setGuestCookie(response: NextResponse, workspace: ReturnType<typeof guestWorkspace>) {
  if (workspace.fresh) response.cookies.set(cookieName, workspace.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}
