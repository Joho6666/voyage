import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { commandSchemas, errorEnvelope, type SkillCommand } from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import { createRuntime } from "@/skill/runtime";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import { guestWorkspace, setGuestCookie } from "../workspace";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/api-guards";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * This single endpoint can drive every paid backend, so the budget follows the
 * command instead of the route: local reads/writes stay unlimited, provider
 * commands share the same windows their dedicated routes use. Without this the
 * per-route limits are trivially bypassed.
 */
const COMMAND_RATE_SCOPES: Partial<Record<SkillCommand, keyof typeof RATE_LIMITS>> = {
  "create-trip": "planning",
  "replan-trip": "planning",
  "propose-change": "llm",
  "retrieve-travel-knowledge": "llm",
  "search-places": "amap",
  "get-place": "amap",
  "plan-route": "amap",
  "get-route-options": "amap",
  "optimize-transport": "amap",
  "get-weather": "amap",
  "refresh-travel-offers": "fliggy",
  "search-travel-offers": "fliggy",
  "search-flights": "fliggy",
  "search-social": "social",
  "get-social-trending": "social",
  "get-social-evidence": "social",
};

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
  const scope = COMMAND_RATE_SCOPES[command];
  if (scope) {
    const limited = enforceRateLimit(request, scope);
    if (limited) return setGuestCookie(limited, workspace);
  }
  try {
    if (process.env.VOYAGE_DEMO_MODE === "true" && parsed.data && typeof parsed.data === "object") {
      const tripId = "tripId" in parsed.data ? (parsed.data as { tripId?: unknown }).tripId : undefined;
      if (tripId === DEMO_TRIP_ID) {
        const repository = new JsonSkillRepository(workspace.root);
        if (!(await repository.getTrip(DEMO_TRIP_ID))) {
          await repository.createTrip(structuredClone(chongqingTrip));
        }
      }
    }
    const result = await createRuntime(workspace.root).execute(command, parsed.data);
    return reply(result);
  } catch (error) {
    if (error instanceof SkillError) return reply(errorEnvelope(error.code, error.message, error.details), 409);
    if (error instanceof ZodError) return reply(errorEnvelope("INVALID_INPUT", "Input failed validation", error.flatten()), 400);
    logger.error("command.execute_failed", { command, error });
    return reply(errorEnvelope("INTERNAL_ERROR", "Voyage runtime failed"), 500);
  }
}
