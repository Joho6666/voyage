import "server-only";

import { NextRequest } from "next/server";
import { JsonSkillRepository } from "@/skill/repository";
import { guestWorkspace } from "@/app/api/voyage/workspace";
import { planningError, planningReply, sessionPayload } from "../../helpers";
import { failIfGenerationStale } from "./generate/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const workspace = guestWorkspace(request);
  const { id } = await context.params;
  if (!id || id.length > 100) return planningError(workspace, "INVALID_INPUT", "规划会话 ID 无效", 400);
  const repository = new JsonSkillRepository(workspace.root);
  const session = await repository.getPlanningSession(id);
  if (!session) return planningError(workspace, "PLANNING_SESSION_NOT_FOUND", "规划会话不存在", 404);
  // A detached generation worker dies with the process; a session left in
  // "generating" past the stale window would otherwise be LOCKED forever.
  const effective = await failIfGenerationStale(repository, session);
  return planningReply(workspace, sessionPayload(effective));
}
