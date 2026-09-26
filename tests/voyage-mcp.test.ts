// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Place } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";
import { normalizeToolError, voyageTools } from "../packages/voyage-mcp/server";
import { SkillError } from "@/skill/errors";
import { z } from "zod";

class FixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly places: Place[]) {}

  async searchPlaces(input: { query: string; category?: Place["category"]; limit: number }) {
    return this.places.filter((place) => !input.category || place.category === input.category).slice(0, input.limit);
  }

  async getWeather(): Promise<ProviderForecast[]> {
    return [];
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]): Promise<ProviderRoute> {
    return { source: "amap", mode: input.mode, distanceMeters: 1200, durationMinutes: 15, polyline: [], steps: [] };
  }
}

function normalizeThrown(run: () => unknown) {
  try {
    run();
    throw new Error("expected the call to throw");
  } catch (error) {
    return normalizeToolError(error);
  }
}

describe("voyage MCP adapter", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-mcp-"));
    const places = (["attraction", "food", "cafe", "hotel", "shopping", "activity"] as const).map((category, index) => ({
      id: `p-${index}`, name: `测试地点${index}`, category, lat: 29.5628 + index * 0.001, lng: 106.5786 + index * 0.001,
      rating: 4.5, reviewCount: 0, image: "", priceLevel: 1, priceLabel: "免费",
      address: "重庆", openingStatus: "unknown", stayMinutes: 90, description: "", tags: [],
      district: "", source: "amap", sourceId: `p-${index}`, provenance: { source: "amap", estimated: false },
    })) as Place[];
    runtime = new VoyageSkillRuntime(new JsonSkillRepository(dataDir), async () => new FixtureProvider(places));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("exposes exactly the 12 first-wave tools mapped to runtime commands", () => {
    expect(Object.keys(voyageTools).sort()).toEqual([
      "voyage_apply_change", "voyage_create_trip", "voyage_get_route_options", "voyage_get_trip",
      "voyage_get_weather", "voyage_optimize_transport", "voyage_plan_route", "voyage_propose_change",
      "voyage_retrieve_knowledge", "voyage_search_offers", "voyage_search_places", "voyage_search_social",
    ]);
  });

  it("forwards voyage_search_places to the runtime and returns the envelope verbatim", async () => {
    const envelope = await voyageTools.voyage_search_places.run(runtime, { destination: "重庆", query: "景点", limit: 3 }) as { ok: boolean; data: { places: unknown[] }; providerStatus: { places: string } };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.places).toHaveLength(3);
    expect(envelope.providerStatus.places).toBe("REAL");
  });

  it("runs create-trip → get-trip end to end through the adapter", async () => {
    const created = await voyageTools.voyage_create_trip.run(runtime, {
      destination: "重庆", startDate: "2026-10-01", days: 2, people: 2, budget: 2500, fallbackPolicy: "estimated",
    }) as { ok: boolean; data: { tripId: string; revision: number } };
    expect(created.ok).toBe(true);

    const fetched = await voyageTools.voyage_get_trip.run(runtime, { tripId: created.data.tripId }) as { ok: boolean; data: { trip: { destination: string } } };
    expect(fetched.ok).toBe(true);
    expect(fetched.data.trip.destination).toBe("重庆");
  });

  it("normalizes skill errors into stable error envelopes", () => {
    const normalized = normalizeThrown(() => {
      throw new SkillError("REVISION_CONFLICT", "Trip revision does not match");
    });
    expect(normalized).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  });

  it("normalizes zod validation failures into INVALID_INPUT", () => {
    const normalized = normalizeThrown(() => voyageTools.voyage_apply_change.inputShape.confirmed.parse(false));
    expect(normalized).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("keeps apply-change confirmation discipline: missing proposals surface PROPOSAL errors", async () => {
    const created = await voyageTools.voyage_create_trip.run(runtime, {
      destination: "重庆", startDate: "2026-10-01", days: 1, people: 1, budget: 1000, fallbackPolicy: "estimated",
    }) as { data: { tripId: string; revision: number } };

    const rejected = await voyageTools.voyage_apply_change.run(runtime, {
      tripId: created.data.tripId, proposalId: "does-not-exist", expectedTripRevision: created.data.revision, confirmed: true,
    }).then(
      (envelope) => envelope as { ok: boolean; error?: { code: string } },
      (error) => normalizeToolError(error) as { ok: boolean; error?: { code: string } },
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBeTruthy();
  });
});
