import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { commandSchemas, errorEnvelope, type SkillCommand } from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import { createRuntime } from "@/skill/runtime";
import { guestWorkspace, setGuestCookie } from "../workspace";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const reply = (body: unknown, status = 200) => setGuestCookie(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), workspace);
  const body = await request.json().catch(() => null) as { command?: string; input?: unknown } | null;
  const command = body?.command as SkillCommand | undefined;
  if (!command || !(command in commandSchemas)) {
    return reply(errorEnvelope("INVALID_INPUT", "Unknown Voyage command"), 400);
  }
  const parsed = commandSchemas[command].safeParse(body?.input);
  if (!parsed.success) {
    return reply(errorEnvelope("INVALID_INPUT", "Input failed command schema validation", parsed.error.flatten()), 400);
  }
  try {
    const result = await createRuntime(workspace.root).execute(command, parsed.data);
    return reply(result);
  } catch (error) {
    if (error instanceof SkillError) return reply(errorEnvelope(error.code, error.message, error.details), 409);
    if (error instanceof ZodError) return reply(errorEnvelope("INVALID_INPUT", "Input failed validation", error.flatten()), 400);
    return reply(errorEnvelope("INTERNAL_ERROR", "Voyage runtime failed"), 500);
  }
}
