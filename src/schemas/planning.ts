import { z } from "zod";

/**
 * Canonical bounds for the conversational planning surface.  Keeping these
 * limits here makes the browser/API boundary and the persisted session agree
 * on what a planning conversation may contain.
 */
export const MAX_PLANNING_MESSAGE_CHARS = 2_000;
export const MAX_PLANNING_MESSAGES = 24;
export const MAX_PLANNING_TOTAL_MESSAGE_CHARS = 24_000;
export const MAX_PLANNING_LIST_ITEMS = 20;
export const MAX_PLANNING_LIST_ITEM_CHARS = 80;
/**
 * The longest trip a planning profile can describe at all. Anything above this
 * cannot be represented here, so helpers must never derive such a value — a
 * profile that its own schema rejects is unusable and used to surface as a raw
 * Zod error in the UI.
 */
export const MAX_PLANNING_DAYS = 31;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = (maxItems = MAX_PLANNING_LIST_ITEMS) =>
  z.array(boundedText(MAX_PLANNING_LIST_ITEM_CHARS)).max(maxItems);

export const planningPaceSchema = z.enum(["relaxed", "balanced", "packed"]);
export const planningWalkingToleranceSchema = z.enum(["low", "medium", "high"]);
export const planningTransportPreferenceSchema = z.enum([
  "mixed",
  "public",
  "metro",
  "bus",
  "taxi",
  "drive",
  "walk",
]);
export const planningBudgetModeSchema = z.enum(["tight", "balanced", "flexible"]);

/**
 * Accessibility and companion fields intentionally accept either a boolean
 * or a count/list.  The conversational layer can preserve what the traveller
 * actually said without guessing a count when they only said "带老人".
 */
export const planningAccessibilitySchema = z.union([
  z.boolean(),
  boundedList(8),
]);
export const planningCompanionSchema = z.union([
  z.boolean(),
  z.number().int().min(0).max(20),
]);

const planningProfileFields = {
  destination: boundedText(80).optional(),
  origin: z.string().trim().max(80).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  days: z.number().int().min(1).max(MAX_PLANNING_DAYS).optional(),
  travelers: z.number().int().min(1).max(20).optional(),
  budget: z.number().min(0).max(1_000_000).optional(),
  pace: planningPaceSchema.optional(),
  walkingTolerance: planningWalkingToleranceSchema.optional(),
  transportPreference: planningTransportPreferenceSchema.optional(),
  vibes: boundedList(12).default([]),
  mustVisit: boundedList().default([]),
  avoid: boundedList().default([]),
  dietary: boundedList(8).default([]),
  accessibility: planningAccessibilitySchema.optional(),
  /** Compatibility alias for callers that use the transport-context name. */
  accessibilityNeeds: planningAccessibilitySchema.optional(),
  children: planningCompanionSchema.optional(),
  elderly: planningCompanionSchema.optional(),
  budgetMode: planningBudgetModeSchema.optional(),
  socialOptIn: z.boolean().default(false),
  includeExternalOffers: z.boolean().default(false),
  /** Compatibility input accepted at the boundary and normalized by helpers. */
  includeSocialEvidence: z.boolean().optional(),
} as const;

/** A complete, canonical profile. Core facts remain optional until gathered. */
export const planningProfileSchema = z
  .object(planningProfileFields)
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.startDate && profile.endDate && profile.endDate < profile.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate must not precede startDate" });
    }
    if (profile.accessibility !== undefined && profile.accessibilityNeeds !== undefined) {
      const left = JSON.stringify(profile.accessibility);
      const right = JSON.stringify(profile.accessibilityNeeds);
      if (left !== right) {
        ctx.addIssue({ code: "custom", path: ["accessibilityNeeds"], message: "accessibility fields disagree" });
      }
    }
  });

/** Patch form used for one conversational turn. */
export const planningProfilePatchSchema = z
  .object({
    destination: planningProfileFields.destination,
    origin: planningProfileFields.origin,
    startDate: planningProfileFields.startDate,
    endDate: planningProfileFields.endDate,
    days: planningProfileFields.days,
    travelers: planningProfileFields.travelers,
    budget: planningProfileFields.budget,
    pace: planningProfileFields.pace,
    walkingTolerance: planningProfileFields.walkingTolerance,
    transportPreference: planningProfileFields.transportPreference,
    vibes: z.array(boundedText(MAX_PLANNING_LIST_ITEM_CHARS)).max(12).optional(),
    mustVisit: z.array(boundedText(MAX_PLANNING_LIST_ITEM_CHARS)).max(MAX_PLANNING_LIST_ITEMS).optional(),
    avoid: z.array(boundedText(MAX_PLANNING_LIST_ITEM_CHARS)).max(MAX_PLANNING_LIST_ITEMS).optional(),
    dietary: z.array(boundedText(MAX_PLANNING_LIST_ITEM_CHARS)).max(8).optional(),
    accessibility: planningAccessibilitySchema.optional(),
    accessibilityNeeds: planningAccessibilitySchema.optional(),
    children: planningCompanionSchema.optional(),
    elderly: planningCompanionSchema.optional(),
    budgetMode: planningBudgetModeSchema.optional(),
    socialOptIn: z.boolean().optional(),
    includeExternalOffers: z.boolean().optional(),
    includeSocialEvidence: z.boolean().optional(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.startDate && profile.endDate && profile.endDate < profile.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate must not precede startDate" });
    }
    if (profile.accessibility !== undefined && profile.accessibilityNeeds !== undefined) {
      const left = JSON.stringify(profile.accessibility);
      const right = JSON.stringify(profile.accessibilityNeeds);
      if (left !== right) {
        ctx.addIssue({ code: "custom", path: ["accessibilityNeeds"], message: "accessibility fields disagree" });
      }
    }
  });

export const planningMessageRoleSchema = z.enum(["user", "assistant"]);

export const planningMessageSchema = z
  .object({
    id: boundedText(100),
    role: planningMessageRoleSchema,
    content: z.string().trim().min(1).max(MAX_PLANNING_MESSAGE_CHARS),
    createdAt: z.string().min(1).max(80).optional(),
  })
  .strict();

export const planningMessagesSchema = z
  .array(planningMessageSchema)
  .max(MAX_PLANNING_MESSAGES)
  .superRefine((messages, ctx) => {
    const total = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (total > MAX_PLANNING_TOTAL_MESSAGE_CHARS) {
      ctx.addIssue({ code: "custom", message: "planning message history is too large" });
    }
  });

export const planningSessionStatusSchema = z.enum(["collecting", "active", "ready", "generating", "completed", "failed"]);
export const planningLlmStatusSchema = z.enum(["used", "unavailable", "failed", "skipped"]);
export const planningConflictSchema = z.object({
  fields: z.array(z.string().trim().min(1).max(80)).max(8),
  message: boundedText(240),
  resolutionOptions: z.array(boundedText(120)).max(4).optional(),
}).strict();

export const planningSessionSchema = z
  .object({
    id: boundedText(100),
    /** The workspace is normally supplied by the repository root. */
    workspaceId: z.string().trim().max(200).optional(),
    revision: z.number().int().min(1).default(1),
    profile: planningProfileSchema.default({
      vibes: [],
      mustVisit: [],
      avoid: [],
      dietary: [],
      socialOptIn: false,
      includeExternalOffers: false,
    }),
    messages: planningMessagesSchema.default([]),
    status: planningSessionStatusSchema.default("collecting"),
    summary: z.string().trim().max(600).optional(),
    missingFields: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
    suggestedReplies: z.array(boundedText(160)).max(8).default([]),
    conflicts: z.array(planningConflictSchema).max(8).default([]),
    llmStatus: planningLlmStatusSchema.default("skipped"),
    fallbackReason: z.string().trim().max(240).optional(),
    tripId: boundedText(100).optional(),
    lastQuestion: z.string().trim().max(240).nullable().optional(),
    createdAt: z.string().min(1).max(80),
    updatedAt: z.string().min(1).max(80),
  })
  .strict();

export const planningTurnInputSchema = z
  .object({
    sessionId: boundedText(100).optional(),
    message: z.string().trim().min(1).max(MAX_PLANNING_MESSAGE_CHARS).optional(),
    profile: planningProfilePatchSchema.optional(),
    planningProfile: planningProfilePatchSchema.optional(),
    expectedRevision: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((input) => input.message !== undefined || input.profile !== undefined || input.planningProfile !== undefined, {
    message: "message or planning profile is required",
  });

export const getPlanningSessionInputSchema = z.object({ sessionId: boundedText(100) }).strict();

export type PlanningProfile = z.output<typeof planningProfileSchema>;
export type PlanningProfilePatch = z.output<typeof planningProfilePatchSchema>;
export type PlanningMessage = z.output<typeof planningMessageSchema>;
export type PlanningSession = z.output<typeof planningSessionSchema>;
export type PlanningTurnInput = z.output<typeof planningTurnInputSchema>;
export type PlanningField =
  | "destination"
  | "dates"
  | "travelers"
  | "budget"
  | "pace"
  | "walkingTolerance"
  | "transportPreference"
  | "vibes"
  | "mustVisit"
  | "avoid"
  | "dietary"
  | "accessibility"
  | "children"
  | "elderly"
  | "budgetMode"
  | "socialOptIn";
