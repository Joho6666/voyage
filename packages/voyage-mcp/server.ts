/**
 * Voyage MCP adapter.
 *
 * This layer owns nothing but transport: tool registration, zod shape
 * translation, and error normalization. Every tool delegates to the same
 * VoyageSkillRuntime the CLI, HTTP adapter, and Web agent use — the runtime
 * re-validates each payload against its canonical input schema, so this file
 * must never duplicate or loosen business rules.
 */
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { errorEnvelope, SCHEMA_VERSION } from "../../src/skill/contracts";
import { SkillError } from "../../src/skill/errors";
import { createRuntime, type VoyageSkillRuntime } from "../../src/skill/runtime";

export interface VoyageToolDefinition {
  description: string;
  inputShape: z.ZodRawShape;
  /** MCP hints so hosts can gate writes behind a user confirmation dialog. */
  annotations: ToolAnnotations;
  /** Optional adapter-side rendering of a success envelope for humans. */
  format?: (envelope: Record<string, unknown>) => string;
  run: (runtime: VoyageSkillRuntime, input: unknown) => Promise<unknown>;
}

const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

function tool(
  description: string,
  inputShape: z.ZodRawShape,
  command: Parameters<VoyageSkillRuntime["execute"]>[0],
  options: { annotations?: ToolAnnotations; format?: VoyageToolDefinition["format"] } = {},
): VoyageToolDefinition {
  return {
    description,
    inputShape,
    annotations: options.annotations ?? READ_ONLY,
    format: options.format,
    async run(runtime, input) {
      return runtime.execute(command, input);
    },
  };
}

const pointShape = { lat: z.number(), lng: z.number() };

/** Human-readable rendering of a proposal's diff so the agent can show the
 * user exactly what is about to change before asking for consent. */
function formatDiffSummary(envelope: Record<string, unknown>) {
  const data = (envelope.data ?? {}) as {
    proposalId?: string;
    proposalToken?: string;
    baseRevision?: number;
    changes?: {
      summary?: string;
      metrics?: {
        walkDistanceBeforeMeters?: number;
        walkDistanceAfterMeters?: number;
        walkDistanceDiffMeters?: number;
        walkDurationSavedMinutes?: number;
        estimatedCostBefore?: number;
        estimatedCostAfter?: number;
        costDiff?: number;
        transitChanges?: Array<{ fromPlaceName: string; toPlaceName: string; oldMode: string; newMode: string; detail?: string }>;
      };
      itemChanges?: Array<{ type: string; placeName: string; detail: string }>;
    };
  };
  const lines: string[] = ["── 提案 Diff（供用户确认，未应用到行程）──"];
  if (data.changes?.summary) lines.push(`摘要：${data.changes.summary}`);
  const metrics = data.changes?.metrics;
  if (metrics) {
    lines.push(
      `步行距离：${metrics.walkDistanceBeforeMeters ?? "?"} m → ${metrics.walkDistanceAfterMeters ?? "?"} m（${(metrics.walkDistanceDiffMeters ?? 0) <= 0 ? "减少" : "增加"} ${Math.abs(metrics.walkDistanceDiffMeters ?? 0)} m）`,
    );
    if (typeof metrics.walkDurationSavedMinutes === "number" && metrics.walkDurationSavedMinutes > 0) {
      lines.push(`节省步行时间：${metrics.walkDurationSavedMinutes} 分钟`);
    }
    if (typeof metrics.estimatedCostBefore === "number") {
      const diff = metrics.costDiff ?? 0;
      lines.push(`预计费用：¥${metrics.estimatedCostBefore} → ¥${metrics.estimatedCostAfter ?? "?"}（${diff <= 0 ? "节省" : "增加"} ¥${Math.abs(diff)}）`);
    }
    for (const change of metrics.transitChanges ?? []) {
      lines.push(`交通：${change.fromPlaceName} → ${change.toPlaceName}：${change.oldMode} 换成 ${change.newMode}${change.detail ? `（${change.detail}）` : ""}`);
    }
  }
  for (const item of data.changes?.itemChanges ?? []) {
    lines.push(`条目[${item.type}] ${item.placeName}：${item.detail}`);
  }
  lines.push(`提案 ID：${data.proposalId ?? "?"} · 基准 revision：${data.baseRevision ?? "?"}（token 有效期 10 分钟，一次性）`);
  lines.push("必须先把以上 Diff 展示给用户，得到明确同意后才能用 proposalToken 调用 voyage_apply_change。");
  return lines.join("\n");
}

/** The 12 first-wave tools map one-to-one onto runtime commands. */
export const voyageTools: Record<string, VoyageToolDefinition> = {
  voyage_create_trip: tool(
    "Create a structured Voyage Trip from real provider data",
    {
      destination: z.string(), startDate: z.string(),
      origin: z.string().optional(), endDate: z.string().optional(), days: z.number().optional(),
      people: z.number().optional(), budget: z.number().optional(),
      preferences: z.array(z.string()).optional(), walkingTolerance: z.enum(["low", "medium", "high"]).optional(),
      prompt: z.string().optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "create-trip",
    { annotations: WRITE },
  ),
  voyage_get_trip: tool("Read the authoritative stored Trip", { tripId: z.string() }, "get-trip"),
  voyage_search_places: tool(
    "Search real POIs (attractions, food, hotels, activities)",
    {
      destination: z.string(), query: z.string().optional(), category: z.string().optional(), limit: z.number().optional(),
    },
    "search-places",
  ),
  voyage_plan_route: tool(
    "Plan a single route between two coordinates",
    {
      origin: z.object(pointShape), destination: z.object(pointShape), city: z.string(),
      mode: z.enum(["walk", "metro", "bus", "taxi", "drive"]).optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "plan-route",
  ),
  voyage_get_route_options: tool(
    "Compare walk/metro/bus/taxi/drive with structured scoring",
    {
      origin: z.object(pointShape), destination: z.object(pointShape), city: z.string(),
      modes: z.array(z.enum(["walk", "metro", "bus", "taxi", "drive"])).optional(),
      context: z.record(z.string(), z.unknown()).optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "get-route-options",
  ),
  voyage_optimize_transport: tool(
    "Rank transport options with knowledge-aware context and explanations",
    {
      origin: z.object(pointShape), destination: z.object(pointShape), city: z.string(),
      context: z.record(z.string(), z.unknown()).optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "optimize-transport",
  ),
  voyage_get_weather: tool(
    "Weather forecast for trip dates",
    {
      destination: z.string(), dates: z.array(z.string()), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "get-weather",
  ),
  voyage_retrieve_knowledge: tool(
    "Hybrid RAG over curated travel knowledge; advisory only",
    {
      city: z.string(), query: z.string(), tags: z.array(z.string()).optional(), limit: z.number().optional(),
    },
    "retrieve-travel-knowledge",
  ),
  voyage_search_social: tool(
    "Live multi-platform social travel evidence (platform, metrics, confidence)",
    {
      city: z.string(), query: z.string().optional(), poi: z.string().optional(), platform: z.string().optional(), limit: z.number().optional(),
    },
    "search-social",
  ),
  voyage_search_offers: tool(
    "Search external travel offers (train, hotel, ticket, restaurant, coupon)",
    {
      destination: z.string(), query: z.string(), origin: z.string().optional(),
      startDate: z.string().optional(), endDate: z.string().optional(), travelers: z.number().optional(),
      budget: z.number().optional(), city: z.string().optional(), categories: z.array(z.string()).optional(),
    },
    "search-travel-offers",
  ),
  voyage_propose_change: tool(
    "Generate a Trip change proposal (Diff only; show the diff to the user and only apply after explicit consent)",
    {
      tripId: z.string(), instruction: z.string(), dayId: z.string().optional(),
      asOf: z.string().optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "propose-change",
    { annotations: WRITE, format: formatDiffSummary },
  ),
  voyage_apply_change: tool(
    "Apply a proposal; requires the proposalToken issued by voyage_propose_change, the expected revision, and prior explicit user consent to the shown diff",
    {
      tripId: z.string(), proposalId: z.string(), expectedTripRevision: z.number(),
      confirmed: z.literal(true), proposalToken: z.string().min(1),
    },
    "apply-change",
    { annotations: DESTRUCTIVE },
  ),
  voyage_optimize_itinerary: tool(
    "Re-schedule the trip's planned stops into geographically clustered, time-window aware days (Itinerary Optimizer v1); returns a Diff proposal — show it and only apply after explicit consent",
    {
      tripId: z.string(), expectedTripRevision: z.number(),
      strategy: z.enum(["balanced"]).optional(), preserveMustVisit: z.boolean().optional(),
      fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
    },
    "optimize-itinerary",
    { annotations: WRITE, format: formatDiffSummary },
  ),
  voyage_get_today_context: tool(
    "Today execution console: current stop, next hop (distance, transit, departure/arrival times), remaining stops/walking/end time, lateness vs plan, and deterministic suggestions. Read-only.",
    {
      tripId: z.string(), dayId: z.string().optional(), asOf: z.string().optional(),
    },
    "get-today-context",
  ),
  voyage_get_reservations: tool(
    "List the trip's reservations (flights, trains, hotels, restaurants, tickets) with status and provenance. Read-only.",
    {
      tripId: z.string(), status: z.enum(["tentative", "confirmed", "cancelled", "completed"]).optional(),
      type: z.enum(["flight", "train", "hotel", "restaurant", "attraction", "activity", "car", "transfer", "other"]).optional(),
    },
    "get-reservations",
  ),
  voyage_add_reservation: tool(
    "Record a real-world reservation on the trip (confirmation code, time window, price). Confirmed reservations become hard constraints for replanning. Direct write, revision-locked.",
    {
      tripId: z.string(), expectedTripRevision: z.number(),
      reservation: z.object({
        type: z.enum(["flight", "train", "hotel", "restaurant", "attraction", "activity", "car", "transfer", "other"]),
        title: z.string(),
        startAt: z.string(),
        endAt: z.string().optional(),
        origin: z.string().optional(), destination: z.string().optional(), location: z.string().optional(),
        provider: z.string().optional(), confirmationCode: z.string().optional(),
        price: z.number().optional(), currency: z.string().optional(),
        cancellationPolicy: z.string().optional(),
        flexibility: z.enum(["fixed", "semiFlexible", "flexible"]).optional(),
        status: z.enum(["tentative", "confirmed", "cancelled", "completed"]).optional(),
        linkedItemId: z.string().optional(), notes: z.string().optional(),
      }),
    },
    "add-reservation",
    { annotations: WRITE },
  ),
  voyage_import_reservations: tool(
    "Bulk-import pasted reservations (up to 20) onto the trip; duplicates are detected by confirmation code or type+start time. Direct write, revision-locked.",
    {
      tripId: z.string(), expectedTripRevision: z.number(), vendor: z.string().optional(),
      reservations: z.array(z.object({
        type: z.enum(["flight", "train", "hotel", "restaurant", "attraction", "activity", "car", "transfer", "other"]),
        title: z.string(), startAt: z.string(), endAt: z.string().optional(),
        origin: z.string().optional(), destination: z.string().optional(), location: z.string().optional(),
        provider: z.string().optional(), confirmationCode: z.string().optional(),
        price: z.number().optional(), currency: z.string().optional(),
        cancellationPolicy: z.string().optional(),
        flexibility: z.enum(["fixed", "semiFlexible", "flexible"]).optional(),
        status: z.enum(["tentative", "confirmed", "cancelled", "completed"]).optional(),
        linkedItemId: z.string().optional(), notes: z.string().optional(),
      })),
    },
    "import-reservations",
    { annotations: WRITE },
  ),
};

export function normalizeToolError(error: unknown) {
  if (error instanceof SkillError) return errorEnvelope(error.code, error.message, error.details);
  if (error instanceof z.ZodError) return errorEnvelope("INVALID_INPUT", error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  return errorEnvelope("INTERNAL_ERROR", error instanceof Error ? error.message : "unknown failure");
}

type ToolResult = { isError: boolean; content: Array<{ type: "text"; text: string }> };

/** Registers every voyage tool on an MCP server instance. Returns the count for tests. */
export function registerVoyageTools(server: McpServer, runtime: VoyageSkillRuntime = createRuntime()): number {
  for (const [name, definition] of Object.entries(voyageTools)) {
    server.registerTool(
      name,
      { description: definition.description, inputSchema: definition.inputShape, annotations: definition.annotations },
      async (args) => {
        try {
          const envelope = (await definition.run(runtime, args)) as unknown as Record<string, unknown>;
          const ok = envelope.ok !== false;
          const content: ToolResult["content"] = [];
          if (ok && definition.format) {
            content.push({ type: "text", text: definition.format(envelope) });
          }
          content.push({ type: "text", text: JSON.stringify(envelope) });
          return { isError: !ok, content };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: JSON.stringify(normalizeToolError(error)) }] };
        }
      },
    );
  }
  return Object.keys(voyageTools).length;
}

export async function main() {
  const server = new McpServer({ name: "voyage", version: SCHEMA_VERSION });
  const registered = registerVoyageTools(server);
  console.error(`voyage-mcp: registered ${registered} tools; data dir: ${process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage")}`);
  await server.connect(new StdioServerTransport());
}

/** Auto-start only when this file is the executed entry; imports (tests) never bind stdio. */
const invokedDirectly = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
