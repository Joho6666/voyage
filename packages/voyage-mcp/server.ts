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
import { errorEnvelope, SCHEMA_VERSION } from "../../src/skill/contracts";
import { SkillError } from "../../src/skill/errors";
import { createRuntime, type VoyageSkillRuntime } from "../../src/skill/runtime";

export interface VoyageToolDefinition {
  description: string;
  inputShape: z.ZodRawShape;
  run: (runtime: VoyageSkillRuntime, input: unknown) => Promise<unknown>;
}

function tool(
  description: string,
  inputShape: z.ZodRawShape,
  command: Parameters<VoyageSkillRuntime["execute"]>[0],
): VoyageToolDefinition {
  return {
    description,
    inputShape,
    async run(runtime, input) {
      return runtime.execute(command, input);
    },
  };
}

const pointShape = { lat: z.number(), lng: z.number() };

/** The 12 first-wave tools map one-to-one onto runtime commands. */
export const voyageTools: Record<string, VoyageToolDefinition> = {
  voyage_create_trip: tool("Create a structured Voyage Trip from real provider data", {
    destination: z.string(), startDate: z.string(),
    origin: z.string().optional(), endDate: z.string().optional(), days: z.number().optional(),
    people: z.number().optional(), budget: z.number().optional(),
    preferences: z.array(z.string()).optional(), walkingTolerance: z.enum(["low", "medium", "high"]).optional(),
    prompt: z.string().optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
  }, "create-trip"),
  voyage_get_trip: tool("Read the authoritative stored Trip", { tripId: z.string() }, "get-trip"),
  voyage_search_places: tool("Search real POIs (attractions, food, hotels, activities)", {
    destination: z.string(), query: z.string().optional(), category: z.string().optional(), limit: z.number().optional(),
  }, "search-places"),
  voyage_plan_route: tool("Plan a single route between two coordinates", {
    origin: z.object(pointShape), destination: z.object(pointShape), city: z.string(),
    mode: z.enum(["walk", "metro", "bus", "taxi", "drive"]).optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
  }, "plan-route"),
  voyage_get_route_options: tool("Compare walk/metro/bus/taxi/drive with structured scoring", {
    origin: z.object(pointShape), destination: z.object(pointShape), city: z.string(),
    modes: z.array(z.enum(["walk", "metro", "bus", "taxi", "drive"])).optional(),
    context: z.record(z.string(), z.unknown()).optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
  }, "get-route-options"),
  voyage_optimize_transport: tool("Rank transport options with knowledge-aware context and explanations", {
    origin: z.object(pointShape), destination: z.object(pointShape), city: z.string(),
    context: z.record(z.string(), z.unknown()).optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
  }, "optimize-transport"),
  voyage_get_weather: tool("Weather forecast for trip dates", {
    destination: z.string(), dates: z.array(z.string()), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
  }, "get-weather"),
  voyage_retrieve_knowledge: tool("Hybrid RAG over curated travel knowledge; advisory only", {
    city: z.string(), query: z.string(), tags: z.array(z.string()).optional(), limit: z.number().optional(),
  }, "retrieve-travel-knowledge"),
  voyage_search_social: tool("Live multi-platform social travel evidence (platform, metrics, confidence)", {
    city: z.string(), query: z.string().optional(), poi: z.string().optional(), platform: z.string().optional(), limit: z.number().optional(),
  }, "search-social"),
  voyage_search_offers: tool("Search external travel offers (train, hotel, ticket, restaurant, coupon)", {
    destination: z.string(), query: z.string(), origin: z.string().optional(),
    startDate: z.string().optional(), endDate: z.string().optional(), travelers: z.number().optional(),
    budget: z.number().optional(), city: z.string().optional(), categories: z.array(z.string()).optional(),
  }, "search-travel-offers"),
  voyage_propose_change: tool("Generate a Trip change proposal (Diff only; user must confirm)", {
    tripId: z.string(), instruction: z.string(), dayId: z.string().optional(), fallbackPolicy: z.enum(["deny", "estimated"]).optional(),
  }, "propose-change"),
  voyage_apply_change: tool("Apply a proposal; requires confirmed:true plus the expected revision from the user's Diff confirmation", {
    tripId: z.string(), proposalId: z.string(), expectedTripRevision: z.number(), confirmed: z.literal(true),
  }, "apply-change"),
};

export function normalizeToolError(error: unknown) {
  if (error instanceof SkillError) return errorEnvelope(error.code, error.message, error.details);
  if (error instanceof z.ZodError) return errorEnvelope("INVALID_INPUT", error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  return errorEnvelope("INTERNAL_ERROR", error instanceof Error ? error.message : "unknown failure");
}

/** Registers every voyage tool on an MCP server instance. Returns the count for tests. */
export function registerVoyageTools(server: McpServer, runtime: VoyageSkillRuntime = createRuntime()): number {
  for (const [name, definition] of Object.entries(voyageTools)) {
    server.tool(name, definition.description, definition.inputShape, async (args) => {
      try {
        const envelope = await definition.run(runtime, args);
        const ok = (envelope as { ok?: boolean }).ok !== false;
        return { isError: !ok, content: [{ type: "text" as const, text: JSON.stringify(envelope) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(normalizeToolError(error)) }] };
      }
    });
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
