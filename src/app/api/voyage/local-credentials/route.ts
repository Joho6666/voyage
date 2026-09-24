import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { configurationPresence, saveLocalCredential, saveLocalCredentials } from "@/services/config/local-credentials";

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
  } catch {
    return NextResponse.json({ error: "Invalid field or value" }, { status: 400 });
  }
}
