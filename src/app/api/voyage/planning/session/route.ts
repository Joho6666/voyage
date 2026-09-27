import "server-only";

import { NextRequest } from "next/server";
import { z } from "zod";
import { JsonSkillRepository } from "@/skill/repository";
import { guestWorkspace } from "@/app/api/voyage/workspace";
import { MAX_PLANNING_MESSAGE_CHARS } from "@/schemas/planning";
import {
  newPlanningId,
  now,
  planningError,
  planningReply,
  planInitialSession,
  sessionFromTurn,
  sessionPayload,
} from "../helpers";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  prompt: z.string().trim().max(MAX_PLANNING_MESSAGE_CHARS).optional(),
  profile: z.unknown().optional(),
}).strict();

export async function POST(request: NextRequest) {
  const workspace = guestWorkspace(request);
  const body = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(body ?? {});
  if (!parsed.success) return planningError(workspace, "INVALID_INPUT", "规划会话输入无效", 400, parsed.error.flatten());

  try {
    const turn = await planInitialSession(parsed.data);
    const session = sessionFromTurn({
      id: newPlanningId(),
      workspaceId: workspace.id,
      profile: turn.profile,
      messages: [
        ...(parsed.data.prompt?.trim() ? [{
          id: `planning_user_${Date.now()}`,
          role: "user" as const,
          content: parsed.data.prompt.trim(),
          createdAt: now(),
        }] : []),
        turn.assistantMessage,
      ],
      turn,
    });
    const stored = await new JsonSkillRepository(workspace.root).createPlanningSession(session);
    return planningReply(workspace, sessionPayload(stored, turn));
  } catch (error) {
    return planningError(workspace, "PLANNING_SESSION_FAILED", error instanceof Error ? error.message : "无法创建规划会话", 422);
  }
}
