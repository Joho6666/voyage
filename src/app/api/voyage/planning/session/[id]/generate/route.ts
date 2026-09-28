import "server-only";

import { NextRequest } from "next/server";
import { z } from "zod";
import { planningProfileSchema } from "@/schemas/planning";
import { alignPlanningDays, effectiveTripDays } from "@/services/planning/profile";
import { createRuntime } from "@/skill/runtime";
import { MAX_TRIP_DAYS } from "@/skill/contracts";
import { JsonSkillRepository, type StoredPlanningSession } from "@/skill/repository";
import { SkillError } from "@/skill/errors";
import { guestWorkspace } from "@/app/api/voyage/workspace";
import { now, planningError, planningReply, planningSessionValue } from "../../../helpers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  expectedRevision: z.number().int().min(1),
  confirmed: z.literal(true),
}).strict();

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "路线生成失败";
  return message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]").slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeData(value: unknown) {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  return value.data;
}

function promptFromSession(session: StoredPlanningSession) {
  const userMessages = session.messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
  return userMessages.slice(0, 2000);
}

function generationInput(session: StoredPlanningSession) {
  // The profile may have been written before the dates were known; normalise it
  // so the day count and the date span cannot disagree downstream.
  const profile = alignPlanningDays(planningProfileSchema.parse(session.profile));
  if (!profile.destination) {
    throw new SkillError("INVALID_INPUT", "请先确认目的地", { missingFields: ["destination"] });
  }
  if (!profile.startDate) {
    throw new SkillError("INVALID_INPUT", "请先确认出发日期；只填写天数还不足以创建带日期的行程", { missingFields: ["startDate"] });
  }
  const days = effectiveTripDays(profile);
  if (!days) {
    throw new SkillError("INVALID_INPUT", "请先确认返程日期或旅行天数", { missingFields: ["dates"] });
  }
  if (days > MAX_TRIP_DAYS) {
    throw new SkillError("INVALID_INPUT", `当前版本最多支持 ${MAX_TRIP_DAYS} 天的行程，这条需求是 ${days} 天`, { maxDays: MAX_TRIP_DAYS, days });
  }

  return {
    origin: profile.origin ?? "",
    destination: profile.destination,
    startDate: profile.startDate,
    // One truth for the trip length: prefer the resolved return date, and only
    // send a day count when no end date exists. Sending both let the compiler
    // and the planner disagree.
    ...(profile.endDate ? { endDate: profile.endDate } : { days }),
    ...(profile.travelers !== undefined ? { travelers: profile.travelers, people: profile.travelers } : {}),
    ...(profile.budget !== undefined ? { budget: profile.budget } : {}),
    preferences: profile.vibes,
    vibes: profile.vibes,
    ...(profile.walkingTolerance ? { walkingTolerance: profile.walkingTolerance } : {}),
    // The profile block is appended once by the Runtime; repeating it here put a
    // second, competing day count into the model's prompt.
    prompt: promptFromSession(session),
    planningProfile: profile,
    planningSessionId: session.id,
    fallbackPolicy: "estimated" as const,
    includeExternalOffers: profile.includeExternalOffers,
    includeSocialEvidence: profile.socialOptIn || profile.includeSocialEvidence === true,
  };
}

async function markFailed(repository: JsonSkillRepository, session: StoredPlanningSession, reason: string) {
  try {
    return await repository.updatePlanningSession({
      sessionId: session.id,
      expectedRevision: session.revision,
      session: {
        ...planningSessionValue(session),
        status: "failed",
        fallbackReason: reason,
        updatedAt: now(),
      },
    });
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, context: Context) {
  const workspace = guestWorkspace(request);
  const { id } = await context.params;
  const repository = new JsonSkillRepository(workspace.root);
  const stored = await repository.getPlanningSession(id);
  if (!stored) return planningError(workspace, "PLANNING_SESSION_NOT_FOUND", "规划会话不存在", 404);

  const body = await request.json().catch(() => null);
  if (!isRecord(body) || body.confirmed !== true) {
    return planningError(workspace, "CONFIRMATION_REQUIRED", "生成路线必须由用户显式 confirmed=true 确认", 409);
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return planningError(workspace, "INVALID_INPUT", "路线生成输入无效", 400, parsed.error.flatten());
  if (stored.revision !== parsed.data.expectedRevision) {
    return planningError(workspace, "REVISION_CONFLICT", "规划会话已更新，请刷新后再生成", 409, { revision: stored.revision });
  }
  if (stored.status === "generating" || stored.status === "completed") {
    return planningError(workspace, "PLANNING_SESSION_LOCKED", "当前规划会话已经在生成或已完成", 409);
  }

  let input: ReturnType<typeof generationInput>;
  try {
    input = generationInput(stored);
  } catch (error) {
    if (error instanceof SkillError) return planningError(workspace, error.code, error.message, 422, error.details);
    return planningError(workspace, "INVALID_INPUT", "规划画像无效", 422);
  }

  let generating: StoredPlanningSession;
  try {
    generating = await repository.updatePlanningSession({
      sessionId: id,
      expectedRevision: stored.revision,
      session: {
        ...planningSessionValue(stored),
        status: "generating",
        updatedAt: now(),
      },
    });
  } catch (error) {
    if (error instanceof SkillError) return planningError(workspace, error.code, error.message, 409, error.details);
    return planningError(workspace, "PLANNING_GENERATE_FAILED", "无法锁定规划会话", 409);
  }

  try {
    const result = await createRuntime(workspace.root).createTrip(input);
    const data = runtimeData(result);
    const tripId = data && typeof data.tripId === "string"
      ? data.tripId
      : data && isRecord(data.trip) && typeof data.trip.id === "string"
        ? data.trip.id
        : undefined;
    if (!tripId) throw new SkillError("INTERNAL_ERROR", "路线 Runtime 没有返回行程 ID");

    const completed = await repository.updatePlanningSession({
      sessionId: id,
      expectedRevision: generating.revision,
      session: {
        ...planningSessionValue(generating),
        status: "completed",
        tripId,
        missingFields: [],
        lastQuestion: null,
        fallbackReason: undefined,
        updatedAt: now(),
      },
    });

    if (!isRecord(result)) throw new SkillError("INTERNAL_ERROR", "路线 Runtime 返回格式无效");
    return planningReply(workspace, {
      ...result,
      data: {
        ...(data ?? {}),
        sessionId: id,
        planningSessionId: id,
        planningRevision: completed.revision,
        session: completed,
      },
    });
  } catch (error) {
    const reason = safeErrorMessage(error);
    await markFailed(repository, generating, reason);
    if (error instanceof SkillError) {
      const status = error.code === "CONFIRMATION_REQUIRED" ? 409 : 422;
      return planningError(workspace, error.code, error.message, status, error.details);
    }
    return planningError(workspace, "PLANNING_GENERATE_FAILED", reason, 422);
  }
}
