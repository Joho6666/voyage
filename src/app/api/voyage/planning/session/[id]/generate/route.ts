import "server-only";

import { NextRequest } from "next/server";
import { z } from "zod";
import { planningProfileSchema } from "@/schemas/planning";
import { alignPlanningDays, effectiveTripDays } from "@/services/planning/profile";
import { resolveGuideCandidates } from "@/services/planning/guide-extract";
import { optimizeGuideDayAssignment } from "@/services/itinerary-optimizer";
import { providerFromEnvironment } from "@/skill/providers";
import { createRuntime } from "@/skill/runtime";
import type { Place } from "@/types/travel";
import { MAX_TRIP_DAYS } from "@/lib/trip-limits";
import { JsonSkillRepository, type StoredPlanningSession } from "@/skill/repository";
import { SkillError } from "@/skill/errors";
import { guestWorkspace } from "@/app/api/voyage/workspace";
import { now, planningError, planningFailureMessage, planningReply, planningSessionValue } from "../../../helpers";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  expectedRevision: z.number().int().min(1),
  confirmed: z.literal(true),
}).strict();

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
  } catch (error) {
    logger.warn("planning-generate.mark_failed_write", { sessionId: session.id, error });
    return null;
  }
}

/** How long a "generating" session may sit untouched before GET treats the
 * worker as dead (crashed process, killed server) and fails the session. */
export const GENERATION_STALE_MS = 10 * 60 * 1000;

/** Fails a session stuck in "generating" — the self-heal for a crashed or
 * restarted process, where no detached worker is left to write an outcome. */
export async function failIfGenerationStale(repository: JsonSkillRepository, session: StoredPlanningSession) {
  if (session.status !== "generating") return session;
  const age = Date.now() - new Date(session.updatedAt).getTime();
  if (age < GENERATION_STALE_MS) return session;
  return await markFailed(repository, session, "生成超时（服务可能中断过），请重试") ?? session;
}

async function runGeneration(
  workspaceRoot: string,
  repository: JsonSkillRepository,
  generating: StoredPlanningSession,
  input: ReturnType<typeof generationInput>,
  id: string,
) {
  try {
    const runtime = createRuntime(workspaceRoot);
    const result = await runtime.createTrip(input);
    let data = runtimeData(result);
    const tripId = data && typeof data.tripId === "string"
      ? data.tripId
      : data && isRecord(data.trip) && typeof data.trip.id === "string"
        ? data.trip.id
        : undefined;
    if (!tripId) throw new SkillError("INTERNAL_ERROR", "路线 Runtime 没有返回行程 ID");

    // A guide link pasted during planning: re-resolve its place names against a
    // real provider here (names from the client are never trusted as
    // locations) and seed them into the new trip through the itinerary
    // optimizer, which clusters geographically and respects time windows and
    // the user's profile. The guide's original order stays a signal. Failure
    // never blocks generation.
    const extraWarnings: string[] = [];
    const importedNames = generating.importedPlaces ?? [];
    if (importedNames.length && data) {
      try {
        const provider = await providerFromEnvironment();
        const candidates = await resolveGuideCandidates(provider, generating.profile.destination ?? "", importedNames);
        const resolvedPlaces = candidates.filter((candidate) => candidate.resolved && candidate.place).map((candidate) => candidate.place as Place);
        const tripDays = isRecord(data.trip) && Array.isArray(data.trip.days)
          ? (data.trip.days as Array<{ id?: unknown; date?: unknown; weather?: { condition?: string; icon?: string } }>)
              .filter((day): day is { id: string; date?: string; weather?: { condition?: string; icon?: string } } => typeof day?.id === "string")
          : [];
        if (resolvedPlaces.length && tripDays.length) {
          const optimization = optimizeGuideDayAssignment({
            places: resolvedPlaces,
            days: tripDays.map((day) => ({ dayId: day.id, date: day.date, weather: day.weather })),
            profile: generating.profile ?? null,
            hotel: isRecord(data.trip) && Array.isArray(data.trip.hotels) ? (data.trip.hotels as Place[])[0] ?? null : null,
          });
          const assignments = optimization.assignments
            .map((assignment) => ({ dayId: assignment.dayId, places: assignment.places }))
            .filter((assignment) => assignment.places.length > 0);
          if (optimization.decisions.length) {
            extraWarnings.push(`智能排程：${optimization.decisions.slice(0, 2).map((decision) => decision.reason).join("；")}`);
          }
          if (optimization.unresolvedConstraints.length) {
            extraWarnings.push(optimization.unresolvedConstraints[0]);
          }
          const imported = await runtime.importRoute({
            tripId,
            assignments,
            createTasks: true,
            expectedTripRevision: typeof data.revision === "number" ? data.revision : 1,
          });
          const importedData = runtimeData(imported);
          if (isRecord(importedData?.trip)) {
            // Carry the post-import revision: the client hydrates its store from
            // this, and every later write is revision-locked.
            data = { ...data, trip: importedData.trip, revision: importedData.revision ?? data.revision, importedCount: importedData.importedCount ?? resolvedPlaces.length };
          }
        }
        const unresolved = candidates.filter((candidate) => !candidate.resolved).map((candidate) => candidate.name);
        if (unresolved.length) {
          extraWarnings.push(`链接里有 ${unresolved.length} 个地点没有在高德找到、未编造：${unresolved.slice(0, 3).join("、")}`);
        }
      } catch (error) {
        logger.warn("planning-generate.imported-places-failed", { error });
        extraWarnings.push(`攻略链接里的地点导入未完成：${planningFailureMessage(error, "导入失败")}`);
      }
    }

    await repository.updatePlanningSession({
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
    logger.info("planning-generate.completed", { sessionId: id, tripId, warnings: extraWarnings.length });
  } catch (error) {
    const reason = planningFailureMessage(error, "路线生成失败");
    await markFailed(repository, generating, reason);
    logger.warn("planning-generate.failed", { sessionId: id, reason });
  }
}

export async function POST(request: NextRequest, context: Context) {
  // Paid providers behind this route share one budget per caller.
  const limited = enforceRateLimit(request, "planning");
  if (limited) return limited;
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
  if (stored.status === "completed") {
    return planningError(workspace, "PLANNING_SESSION_COMPLETED", "这次规划已经完成，行程在「我的旅行」里", 409);
  }
  if (stored.status === "generating") {
    return planningError(workspace, "PLANNING_SESSION_LOCKED", "这次规划正在后台生成中，完成后行程会出现在「我的旅行」", 409);
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

  // Fire-and-forget: the heavy LLM/provider pipeline runs after the response
  // has been sent, so closing the tab no longer cancels a generation — the
  // session record (status + tripId) is the handoff, and the client polls the
  // GET endpoint for the outcome. This app targets a self-hosted Node
  // process, which keeps the detached work alive; a serverless target would
  // need a real queue instead.
  void runGeneration(workspace.root, repository, generating, input, id);

  return planningReply(workspace, {
    ok: true,
    data: {
      status: "generating",
      sessionId: id,
      planningSessionId: id,
      planningRevision: generating.revision,
      revision: generating.revision,
    },
  });
}
