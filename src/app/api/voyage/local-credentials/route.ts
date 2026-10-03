import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { configurationPresence, removeLocalCredential, saveLocalCredential, saveLocalCredentials } from "@/services/config/local-credentials";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function localRequest(request: NextRequest) {
  if (process.env.VOYAGE_LOCAL_SETTINGS_ENABLED !== "1" || process.env.VERCEL || process.env.CI) return false;
  const host = request.nextUrl.hostname;
  const origin = request.headers.get("origin");
  return (host === "localhost" || host === "127.0.0.1") && (!origin || new URL(origin).host === request.nextUrl.host);
}

export async function GET(request: NextRequest) {
  if (!localRequest(request)) return NextResponse.json({ error: "Local access only" }, { status: 403 });
  return NextResponse.json({ configured: await configurationPresence() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!localRequest(request) || request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Local same-origin access only" }, { status: 403 });
  }
  try {
    const body = await request.json() as { key?: unknown; value?: unknown; values?: unknown };
    if (body.values && typeof body.values === "object" && !Array.isArray(body.values)) {
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(body.values as Record<string, unknown>)) {
        if (typeof value !== "string") throw new Error("Invalid input");
        values[key] = value;
      }
      await saveLocalCredentials(values);
    } else {
      if (typeof body.key !== "string" || typeof body.value !== "string") throw new Error("Invalid input");
      await saveLocalCredential(body.key, body.value);
    }
    return NextResponse.json({ ok: true, configured: await configurationPresence() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Deliberately no field values here — this endpoint handles credentials.
    logger.warn("local-credentials.update_rejected", { error });
    return NextResponse.json({ error: "Invalid field or value" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!localRequest(request) || request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Local same-origin access only" }, { status: 403 });
  }
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  try {
    await removeLocalCredential(key);
    return NextResponse.json({ ok: true, configured: await configurationPresence() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logger.warn("local-credentials.delete_rejected", { error });
    return NextResponse.json({ error: "Cannot remove" }, { status: 400 });
  }
}
