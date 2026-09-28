import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  MAX_PLANNING_MESSAGES,
  MAX_PLANNING_TOTAL_MESSAGE_CHARS,
  planningMessageSchema,
  planningMessagesSchema,
  planningProfilePatchSchema,
  planningProfileSchema,
  planningSessionSchema,
  type PlanningMessage,
  type PlanningProfile,
  type PlanningProfilePatch,
  type PlanningSession,
} from "@/schemas/planning";
import {
  mergePlanningProfiles,
  planConversationTurn,
  type ConversationPlannerResult,
} from "@/services/planning/conversation-planner";
import { successEnvelope } from "@/skill/contracts";
import { JsonSkillRepository, type StoredPlanningSession } from "@/skill/repository";
import { guestWorkspace, setGuestCookie } from "@/app/api/voyage/workspace";

export function now() {
  return new Date().toISOString();
}

export function newPlanningId() {
  return `planning_${randomUUID()}`;
}

export function planningReply(
  workspace: ReturnType<typeof guestWorkspace>,
  body: unknown,
  status = 200,
) {
  return setGuestCookie(
    NextResponse.json(body, {
      status,
      headers: { "cache-control": "no-store" },
    }),
    workspace,
  );
}

export function planningError(
  workspace: ReturnType<typeof guestWorkspace>,
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return planningReply(workspace, {
    schemaVersion: "voyage.skill.v1",
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    generatedAt: now(),
  }, status);
}

/**
 * Every planning route must answer with something a traveller can act on.
 * A ZodError's `message` is a JSON dump of issues, which is how
 * `Too big: expected number to be <=31` ended up rendered in the chat.
 */
export function planningFailureMessage(error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join(".") ?? "";
    return field
      ? `规划信息里的「${field}」不合法，请检查后重试。`
      : "规划信息不合法，请检查后重试。";
  }
  const message = error instanceof Error ? error.message : fallback;
  if (!message || /^\s*[\[{]/.test(message)) return fallback;
  return message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]").slice(0, 200);
}

export function parseProfilePatch(value: unknown): PlanningProfilePatch {
  const parsed = planningProfilePatchSchema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new Error("Planning profile is invalid");
  }
  return parsed.data;
}

export function canonicalProfile(value: unknown): PlanningProfile {
  return planningProfileSchema.parse(value ?? {});
}

export function appendPlanningMessages(
  current: PlanningMessage[],
  additions: PlanningMessage[],
) {
  const next = [...current, ...additions].slice(-MAX_PLANNING_MESSAGES);
  while (next.length > 1 && next.reduce((total, item) => total + item.content.length, 0) > MAX_PLANNING_TOTAL_MESSAGE_CHARS) {
    next.shift();
  }
  return planningMessagesSchema.parse(next);
}

export function userMessage(content: string): PlanningMessage {
  return planningMessageSchema.parse({
    id: `planning_user_${randomUUID()}`,
    role: "user",
    content,
    createdAt: now(),
  });
}

export function suggestedReplies(missing: string[], profile: PlanningProfile) {
  if (missing.includes("destination")) return ["我还没决定目的地", "想去一个适合周末的城市"];
  if (missing.includes("dates")) return ["先按 3 天安排", "日期还没定，按最近周末"];
  if (missing.includes("travelers")) return ["就我一个人", "两个人一起"];
  if (missing.includes("budget")) return ["先按 3000 元控制", "预算比较灵活"];
  if (!profile.pace) return ["轻松一点", "安排充实一点"];
  if (!profile.walkingTolerance) return ["少走路", "步行适中就好"];
  return ["可以生成路线了", "再多安排一些当地美食"];
}

function llmState(result: ConversationPlannerResult["llm"]) {
  if (result === "used") return "ready";
  if (result === "failed") return "error";
  return "unavailable";
}

export function sessionPayload(
  session: StoredPlanningSession | PlanningSession,
  turn?: ConversationPlannerResult,
  warnings: string[] = [],
) {
  const missing = turn?.missing ?? session.missingFields;
  const ready = turn?.ready ?? (session.status === "ready" || session.status === "completed");
  const llm = turn?.llm ?? session.llmStatus;
  const fallbackReason = turn?.fallbackReason ?? session.fallbackReason;
  return successEnvelope({
    session,
    sessionId: session.id,
    revision: session.revision,
    profile: session.profile,
    messages: session.messages,
    assistantMessage: turn?.assistantMessage,
    question: turn?.question ?? session.lastQuestion ?? null,
    ready,
    readyToGenerate: ready,
    missing,
    missingFields: missing,
    suggestedReplies: session.suggestedReplies,
    source: turn?.source,
    llm,
    llmStatus: {
      state: llmState(llm),
      status: llm,
      reason: fallbackReason,
    },
    fallbackReason,
    tripId: session.tripId,
  }, undefined, warnings);
}

export function sessionFromTurn(input: {
  id: string;
  workspaceId: string;
  profile: PlanningProfile;
  messages: PlanningMessage[];
  turn: ConversationPlannerResult;
  status?: PlanningSession["status"];
  tripId?: string;
}) {
  const timestamp = now();
  return planningSessionSchema.parse({
    id: input.id,
    workspaceId: input.workspaceId,
    revision: 1,
    profile: input.profile,
    messages: input.messages,
    status: input.status ?? (input.turn.ready ? "ready" : "collecting"),
    missingFields: input.turn.missing,
    suggestedReplies: suggestedReplies(input.turn.missing, input.turn.profile),
    conflicts: [],
    llmStatus: input.turn.llm,
    ...(input.turn.fallbackReason ? { fallbackReason: input.turn.fallbackReason } : {}),
    ...(input.tripId ? { tripId: input.tripId } : {}),
    lastQuestion: input.turn.question,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function planningSessionValue(session: StoredPlanningSession): PlanningSession {
  return planningSessionSchema.parse(
    Object.fromEntries(Object.entries(session).filter(([key]) => key !== "hash")),
  );
}

export async function loadSession(repository: JsonSkillRepository, sessionId: string) {
  return repository.getPlanningSession(sessionId);
}

export function baseProfileFromInput(value: unknown) {
  return mergePlanningProfiles({}, parseProfilePatch(value));
}

export async function planInitialSession(input: {
  profile?: unknown;
  prompt?: string;
}) {
  const profile = baseProfileFromInput(input.profile);
  return planConversationTurn({
    profile,
    message: input.prompt?.trim() || undefined,
    messages: [],
  });
}
