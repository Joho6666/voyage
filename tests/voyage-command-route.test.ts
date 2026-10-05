import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as commandRoute } from "@/app/api/voyage/command/route";
import { chongqingTrip } from "@/data/demo/chongqing";
import { JsonSkillRepository } from "@/skill/repository";
import type { Trip } from "@/types/travel";

const guestId = "22222222-2222-4222-8222-222222222222";
const originalEnv: Record<string, string | undefined> = {};
let dataDir: string;

function setEnv(name: string, value: string | undefined) {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function commandRequest(body: unknown, options: { cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.cookie) headers.set("cookie", `voyage_guest_workspace=${options.cookie}`);
  return new NextRequest("http://local/api/voyage/command", { method: "POST", headers, body: JSON.stringify(body) });
}

function guestRoot(id = guestId) {
  return path.join(dataDir, "guests", id);
}

async function seedTrip(id: string) {
  const trip = structuredClone(chongqingTrip) as Trip;
  trip.id = id;
  trip.days = trip.days.map((day) => ({ ...day, tripId: id }));
  await new JsonSkillRepository(guestRoot()).createTrip(trip);
  return id;
}

describe.sequential("POST /api/voyage/command", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-command-route-"));
    setEnv("VOYAGE_DATA_DIR", dataDir);
    setEnv("VOYAGE_DEMO_MODE", undefined);
    setEnv("VOYAGE_LLM_ENABLED", undefined);
  });

  afterEach(async () => {
    for (const [name, value] of Object.entries(originalEnv)) setEnv(name, value);
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects an unknown command with an INVALID_INPUT envelope", async () => {
    const response = await commandRoute(commandRequest({ command: "not-a-command" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.schemaVersion).toBe("voyage.skill.v1");
  });

  it("rejects input that fails the command schema with flatten details", async () => {
    const response = await commandRoute(commandRequest({ command: "get-trip", input: {} }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details).toBeTruthy();
  });

  it("executes a read for a returning guest inside its workspace", async () => {
    const tripId = await seedTrip("seeded-trip");
    const response = await commandRoute(commandRequest({ command: "get-trip", input: { tripId } }, { cookie: guestId }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.trip.id).toBe(tripId);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("issues the workspace cookie to a fresh guest even on errors", async () => {
    const response = await commandRoute(commandRequest({ command: "get-trip", input: { tripId: "missing-trip" } }, { cookie: undefined }));
    expect(response.status).toBe(409);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("voyage_guest_workspace=");
  });

  it("maps a runtime SkillError to a 409 envelope", async () => {
    const response = await commandRoute(commandRequest({ command: "get-trip", input: { tripId: "missing-trip" } }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("TRIP_NOT_FOUND");
  });

  it("rate-limits scoped commands on the per-guest budget", async () => {
    const tripId = await seedTrip("rate-trip");
    const input = { tripId, instruction: "下雨了，调整第二天的安排", fallbackPolicy: "estimated" as const };
    for (let i = 0; i < 15; i += 1) {
      const response = await commandRoute(commandRequest({ command: "propose-change", input }, { cookie: guestId }));
      // The budget is consumed before execution, so anything but 429 is fine here.
      expect(response.status).not.toBe(429);
    }
    const limited = await commandRoute(commandRequest({ command: "propose-change", input }, { cookie: guestId }));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
