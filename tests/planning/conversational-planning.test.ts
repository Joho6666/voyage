// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createPlanningSession } from "@/app/api/voyage/planning/session/route";
import { GET as readPlanningSession } from "@/app/api/voyage/planning/session/[id]/route";
import { POST as generatePlanningSession } from "@/app/api/voyage/planning/session/[id]/generate/route";
import { filterPlanningCandidates } from "@/services/planning/profile";
import { JsonSkillRepository } from "@/skill/repository";
import type { Place } from "@/types/travel";

const workspaceId = "33333333-3333-4333-8333-333333333333";
const originalDataDir = process.env.VOYAGE_DATA_DIR;
const originalFixture = process.env.VOYAGE_PROVIDER_FIXTURE;
const originalAllowMock = process.env.VOYAGE_ALLOW_MOCK;
const originalLlm = process.env.VOYAGE_LLM_ENABLED;
let dataDir: string;

function request(url: string, options: { body?: unknown; method?: string } = {}) {
  const headers = new Headers({ cookie: `voyage_guest_workspace=${workspaceId}` });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: options.method ?? "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe.sequential("conversational planning", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-conversation-planning-"));
    process.env.VOYAGE_DATA_DIR = dataDir;
    process.env.VOYAGE_PROVIDER_FIXTURE = path.resolve("tests/fixtures/voyage-provider.json");
    process.env.VOYAGE_ALLOW_MOCK = "1";
    process.env.VOYAGE_LLM_ENABLED = "0";
  });

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.VOYAGE_DATA_DIR;
    else process.env.VOYAGE_DATA_DIR = originalDataDir;
    if (originalFixture === undefined) delete process.env.VOYAGE_PROVIDER_FIXTURE;
    else process.env.VOYAGE_PROVIDER_FIXTURE = originalFixture;
    if (originalAllowMock === undefined) delete process.env.VOYAGE_ALLOW_MOCK;
    else process.env.VOYAGE_ALLOW_MOCK = originalAllowMock;
    if (originalLlm === undefined) delete process.env.VOYAGE_LLM_ENABLED;
    else process.env.VOYAGE_LLM_ENABLED = originalLlm;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("keeps provider calls and trip persistence behind explicit generation", async () => {
    const createdResponse = await createPlanningSession(request("http://local/api/voyage/planning/session", {
      body: {
        prompt: "我想去重庆玩三天，轻松一点，少走路",
        profile: {
          destination: "重庆",
          startDate: "2030-05-01",
          days: 3,
          travelers: 2,
          budget: 3000,
          pace: "relaxed",
          walkingTolerance: "low",
          mustVisit: ["洪崖洞民俗风貌区"],
        },
      },
    }));
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as { data: { sessionId: string; revision: number; profile: Record<string, unknown> } };
    expect(created.data.profile.destination).toBe("重庆");
    expect(created.data.revision).toBe(1);

    const repository = new JsonSkillRepository(path.join(dataDir, "guests", workspaceId));
    expect(await repository.listTrips()).toHaveLength(0);

    const rejected = await generatePlanningSession(request("http://local/api/voyage/planning/session/x/generate", {
      body: { expectedRevision: created.data.revision, confirmed: false },
    }), context(created.data.sessionId));
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error.code).toBe("CONFIRMATION_REQUIRED");
    expect(await repository.listTrips()).toHaveLength(0);

    const generatedResponse = await generatePlanningSession(request("http://local/api/voyage/planning/session/x/generate", {
      body: { expectedRevision: created.data.revision, confirmed: true },
    }), context(created.data.sessionId));
    expect(generatedResponse.status).toBe(200);
    const generated = await generatedResponse.json() as {
      ok: boolean;
      data: { tripId: string; trip: { id: string; planningMetadata?: { planningSessionId?: string; planningProfile?: Record<string, unknown> } }; session: { status: string; tripId?: string }; planningRevision: number };
      providerStatus?: { places: string; routes: string };
    };
    expect(generated.ok).toBe(true);
    expect(generated.data.tripId).toBeTruthy();
    expect(generated.data.trip.id).toBe(generated.data.tripId);
    expect(generated.data.trip.planningMetadata?.planningSessionId).toBe(created.data.sessionId);
    expect(generated.data.trip.planningMetadata?.planningProfile?.walkingTolerance).toBe("low");
    expect(generated.data.session.status).toBe("completed");
    expect(generated.data.session.tripId).toBe(generated.data.tripId);
    expect(generated.providerStatus?.places).toBe("MOCK");
    expect(await repository.listTrips()).toHaveLength(1);
  });

  it("does not expose a planning session to another guest workspace", async () => {
    const createdResponse = await createPlanningSession(request("http://local/api/voyage/planning/session", {
      body: { prompt: "想去重庆玩三天" },
    }));
    const created = await createdResponse.json() as { data: { sessionId: string } };

    const own = await readPlanningSession(
      request("http://local/api/voyage/planning/session/x"),
      context(created.data.sessionId),
    );
    expect(own.status).toBe(200);
    expect((await own.json()).data.sessionId).toBe(created.data.sessionId);

    const foreignHeaders = new Headers({ cookie: "voyage_guest_workspace=44444444-4444-4444-8444-444444444444" });
    foreignHeaders.set("content-type", "application/json");
    const foreignRequest = new NextRequest("http://local/api/voyage/planning/session/x/generate", {
      method: "POST",
      headers: foreignHeaders,
      body: JSON.stringify({ expectedRevision: 1, confirmed: true }),
    });
    const foreignRead = await readPlanningSession(foreignRequest, context(created.data.sessionId));
    expect(foreignRead.status).toBe(404);

    const foreign = await generatePlanningSession(foreignRequest, context(created.data.sessionId));
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe("PLANNING_SESSION_NOT_FOUND");
    expect(await new JsonSkillRepository(path.join(dataDir, "guests", "44444444-4444-4444-8444-444444444444")).listTrips()).toHaveLength(0);
  });

  it("filters avoid and walking-intensive candidates without inventing places", () => {
    const places: Place[] = [
      { id: "mountain", name: "山城步道", category: "attraction", lat: 1, lng: 1, rating: 4, reviewCount: 1, image: "", priceLevel: 0, address: "山路", openingStatus: "unknown", stayMinutes: 90, description: "长距离徒步", tags: ["步道"], district: "" },
      { id: "museum", name: "城市博物馆", category: "activity", lat: 1, lng: 1, rating: 4, reviewCount: 1, image: "", priceLevel: 0, address: "市区", openingStatus: "unknown", stayMinutes: 90, description: "室内展览", tags: ["室内"], district: "" },
      { id: "mall", name: "城市商场", category: "shopping", lat: 1, lng: 1, rating: 4, reviewCount: 1, image: "", priceLevel: 1, address: "市区", openingStatus: "unknown", stayMinutes: 60, description: "室内购物", tags: ["室内"], district: "" },
    ];
    const selected = filterPlanningCandidates(places, {
      destination: "测试城",
      vibes: [],
      mustVisit: [],
      avoid: ["商场"],
      dietary: [],
      socialOptIn: false,
      includeExternalOffers: false,
      walkingTolerance: "low",
      pace: "relaxed",
    }, 1);
    expect(selected.map((place) => place.id)).toEqual(["museum"]);
    expect(selected.some((place) => place.id === "mountain")).toBe(false);
    expect(selected.some((place) => place.id === "mall")).toBe(false);
  });
});
