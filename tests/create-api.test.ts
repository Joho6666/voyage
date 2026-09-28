// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonSkillRepository } from "@/skill/repository";

vi.mock("server-only", () => ({}));
vi.mock("@/services/map/amap-rest", () => ({
  isAmapConfigured: vi.fn(() => false),
  amapSearchPois: vi.fn(),
  amapGeocode: vi.fn(),
  amapWeather: vi.fn(),
}));

import { POST } from "@/app/api/agent/create/route";

const guestId = "11111111-1111-4111-8111-111111111111";
const originalDataDir = process.env.VOYAGE_DATA_DIR;
const originalDemoMode = process.env.VOYAGE_DEMO_MODE;
const originalSkipCredentials = process.env.VOYAGE_SKIP_LOCAL_CREDENTIALS;
let dataDir: string;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function request(body: unknown, workspaceId?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (workspaceId) headers.set("cookie", `voyage_guest_workspace=${workspaceId}`);
  return new NextRequest("http://local/api/agent/create", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe.sequential("trip creation provider boundary", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-create-api-"));
    process.env.VOYAGE_DATA_DIR = dataDir;
    process.env.VOYAGE_SKIP_LOCAL_CREDENTIALS = "1";
    delete process.env.VOYAGE_DEMO_MODE;
  });

  afterEach(async () => {
    restoreEnv("VOYAGE_DATA_DIR", originalDataDir);
    restoreEnv("VOYAGE_DEMO_MODE", originalDemoMode);
    restoreEnv("VOYAGE_SKIP_LOCAL_CREDENTIALS", originalSkipCredentials);
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns a structured error instead of a demo trip for arbitrary cities", async () => {
    process.env.VOYAGE_DEMO_MODE = "false";
    const response = await POST(request({
      destination: "广州",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "NO_PROVIDER_CONFIGURED" });
    expect(response.headers.get("set-cookie")).toContain("voyage_guest_workspace=");
  });

  it("uses the shared runtime in demo mode and persists only to the caller workspace", async () => {
    process.env.VOYAGE_DEMO_MODE = "true";
    const response = await POST(request({
      destination: "重庆",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      includeSocialEvidence: false,
    }, guestId));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.source).toBe("rules");
    expect(result.mapProvider).toBe("demo");
    expect(result.trip.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.trip.destination).toBe("重庆");
    expect(result.trip.planningMetadata).toMatchObject({ llm: "skipped", social: "not_requested" });
    expect(result.providerStatus.places).toBe("MOCK");

    const workspaceRecord = await new JsonSkillRepository(path.join(dataDir, "guests", guestId)).getTrip(result.trip.id);
    const globalRecord = await new JsonSkillRepository(dataDir).getTrip(result.trip.id);
    expect(workspaceRecord?.trip.id).toBe(result.trip.id);
    expect(globalRecord).toBeNull();
  });
});
