import "server-only";

import { NextRequest } from "next/server";
import { z } from "zod";
import { MAX_PLANNING_MESSAGE_CHARS, planningProfilePatchSchema } from "@/schemas/planning";
import { mergePlanningProfiles, planConversationTurn } from "@/services/planning/conversation-planner";
import { JsonSkillRepository } from "@/skill/repository";
import { SkillError } from "@/skill/errors";
import { guestWorkspace } from "@/app/api/voyage/workspace";
import {
  appendPlanningMessages,
  now,
  planningError,
  planningReply,
  planningSessionValue,
  sessionPayload,
  suggestedReplies,
  userMessage,
} from "../../../helpers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_PLANNING_MESSAGE_CHARS),
  expectedRevision: z.number().int().min(1),
  profile: planningProfilePatchSchema.optional(),
}).strict();

export async function POST(request: NextRequest, context: Context) {
  const workspace = guestWorkspace(request);
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return planningError(workspace, "INVALID_INPUT", "规划消息输入无效", 400, parsed.error.flatten());

  const repository = new JsonSkillRepository(workspace.root);
  const stored = await repository.getPlanningSession(id);
  if (!stored) return planningError(workspace, "PLANNING_SESSION_NOT_FOUND", "规划会话不存在", 404);
  if (stored.revision !== parsed.data.expectedRevision) {
    return planningError(workspace, "REVISION_CONFLICT", "规划会话已更新，请刷新后继续", 409, { revision: stored.revision });
  }
  if (stored.status === "generating" || stored.status === "completed") {
    return planningError(workspace, "PLANNING_SESSION_LOCKED", "当前规划会话不能继续修改", 409);
  }

  try {
    const profile = parsed.data.profile
      ? mergePlanningProfiles(stored.profile, parsed.data.profile)
      : stored.profile;
    const turn = await planConversationTurn({
      profile,
      messages: stored.messages,
      message: parsed.data.message,
    });
    const messages = appendPlanningMessages(stored.messages, [
      userMessage(parsed.data.message),
      turn.assistantMessage,
    ]);
    const session = planningSessionValue(stored);
    const updated = await repository.updatePlanningSession({
      sessionId: id,
      expectedRevision: parsed.data.expectedRevision,
      session: {
        ...session,
        profile: turn.profile,
        messages,
        status: turn.ready ? "ready" : "collecting",
        missingFields: turn.missing,
        suggestedReplies: suggestedReplies(turn.missing, turn.profile),
        conflicts: [],
        llmStatus: turn.llm,
        fallbackReason: turn.fallbackReason,
        lastQuestion: turn.question,
        updatedAt: now(),
      },
    });
    return planningReply(workspace, sessionPayload(updated, turn, turn.fallbackReason ? [turn.fallbackReason] : []));
  } catch (error) {
    if (error instanceof SkillError) return planningError(workspace, error.code, error.message, 409, error.details);
    return planningError(workspace, "PLANNING_MESSAGE_FAILED", error instanceof Error ? error.message : "无法处理规划消息", 422);
  }
}
