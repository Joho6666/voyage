import "server-only";

import { NextRequest } from "next/server";
import { z } from "zod";
import { JsonSkillRepository } from "@/skill/repository";
import { guestWorkspace } from "@/app/api/voyage/workspace";
import { importedPlacesInputSchema } from "@/schemas/planning";
import { now, planningError, planningReply, planningSessionValue } from "../../../helpers";
import { enforceRateLimit } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  places: importedPlacesInputSchema,
  expectedRevision: z.number().int().min(1),
}).strict();

/**
 * Replaces the session's imported place list with the exact names given
 * (bounded, deduped). Used by the planning UI when the traveller removes a
 * mis-parsed entry from the link card — a pure list edit, no conversation turn
 * and no model call.
 */
export async function POST(request: NextRequest, context: Context) {
  const limited = enforceRateLimit(request, "planning");
  if (limited) return limited;
  const workspace = guestWorkspace(request);
  const { id } = await context.params;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return planningError(workspace, "INVALID_INPUT", "导入地点列表无效", 400, parsed.error.flatten());

  const repository = new JsonSkillRepository(workspace.root);
  const stored = await repository.getPlanningSession(id);
  if (!stored) return planningError(workspace, "PLANNING_SESSION_NOT_FOUND", "规划会话不存在", 404);
  if (stored.revision !== parsed.data.expectedRevision) {
    return planningError(workspace, "REVISION_CONFLICT", "规划会话已更新，请刷新后继续", 409, { revision: stored.revision });
  }
  if (stored.status === "generating" || stored.status === "completed") {
    return planningError(workspace, "PLANNING_SESSION_LOCKED", "当前规划会话不能继续修改", 409);
  }

  const places = Array.from(new Set(parsed.data.places.map((name) => name.trim()).filter(Boolean))).slice(0, 20);
  const updated = await repository.updatePlanningSession({
    sessionId: id,
    expectedRevision: parsed.data.expectedRevision,
    session: {
      ...planningSessionValue(stored),
      importedPlaces: places,
      updatedAt: now(),
    },
  });
  return planningReply(workspace, {
    ok: true,
    data: { sessionId: id, revision: updated.revision, importedPlaces: places },
  });
}
