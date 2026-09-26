import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getSkillTrip } from "@/app/api/skill/trips/[id]/route";
import { POST as importTrip } from "@/app/api/voyage/import/route";
import { authorizeTripImport } from "@/app/api/voyage/workspace";
import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import { JsonSkillRepository } from "@/skill/repository";
import type { Trip } from "@/types/travel";

const guestId = "11111111-1111-4111-8111-111111111111";
const otherGuestId = "22222222-2222-4222-8222-222222222222";
const publicDemoTripIds = [DEMO_TRIP_ID] as const;
const originalDataDir = process.env.VOYAGE_DATA_DIR;
const originalDemoMode = process.env.VOYAGE_DEMO_MODE;
let dataDir: string;

function restoreEnv(name: "VOYAGE_DATA_DIR" | "VOYAGE_DEMO_MODE", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function guestRoot(id = guestId) {
  return path.join(dataDir, "guests", id);
}

function request(url: string, options: { method?: string; body?: unknown; workspaceId?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.workspaceId) headers.set("cookie", `voyage_guest_workspace=${options.workspaceId}`);
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function tripWithId(id: string, title: string): Trip {
  const trip = structuredClone(chongqingTrip);
  trip.id = id;
  trip.title = title;
  trip.days = trip.days.map((day) => ({ ...day, tripId: id }));
  trip.segments = trip.segments.map((segment) => ({ ...segment, tripId: id }));
  trip.tasks = trip.tasks.map((task) => ({ ...task, tripId: id }));
  trip.budgetItems = trip.budgetItems.map((item) => ({ ...item, tripId: id }));
  return trip;
}

async function storeTrip(root: string, id: string, title: string) {
  return new JsonSkillRepository(root).createTrip(tripWithId(id, title));
}

describe.sequential("workspace trip access policy", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-workspace-access-"));
    process.env.VOYAGE_DATA_DIR = dataDir;
    delete process.env.VOYAGE_DEMO_MODE;
  });

  afterEach(async () => {
    restoreEnv("VOYAGE_DATA_DIR", originalDataDir);
    restoreEnv("VOYAGE_DEMO_MODE", originalDemoMode);
    await rm(dataDir, { recursive: true, force: true });
  });

  describe("authorizeTripImport", () => {
    it("allows a trip that already exists in the current workspace", () => {
      expect(authorizeTripImport({ tripId: "workspace-trip", workspaceTripExists: true, demoMode: "false", publicDemoTripIds })).toBe("workspace");
    });

    it("allows only the explicit public demo trip when demo mode is enabled", () => {
      expect(authorizeTripImport({ tripId: DEMO_TRIP_ID, workspaceTripExists: false, demoMode: "true", publicDemoTripIds })).toBe("public-demo");
      expect(authorizeTripImport({ tripId: "another-trip", workspaceTripExists: false, demoMode: "true", publicDemoTripIds })).toBe("denied");
    });

    it("denies a non-workspace trip outside demo mode", () => {
      expect(authorizeTripImport({ tripId: DEMO_TRIP_ID, workspaceTripExists: false, demoMode: "false", publicDemoTripIds })).toBe("denied");
      expect(authorizeTripImport({ tripId: "private-trip", workspaceTripExists: false, publicDemoTripIds })).toBe("denied");
    });
  });

  describe("GET /api/skill/trips/[id]", () => {
    it("does not expose a trip that exists only in the global base repository", async () => {
      await storeTrip(dataDir, "global-private-trip", "Global private trip");

      const response = await getSkillTrip(
        request("http://local/api/skill/trips/global-private-trip"),
        { params: Promise.resolve({ id: "global-private-trip" }) },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ ok: false, error: "TRIP_NOT_FOUND" });
      expect(response.headers.get("set-cookie")).toContain("voyage_guest_workspace=");
    });

    it("reads a trip from only the requesting guest workspace", async () => {
      await storeTrip(guestRoot(), "workspace-trip", "Current workspace trip");
      await storeTrip(guestRoot(otherGuestId), "other-workspace-trip", "Other workspace trip");

      const allowed = await getSkillTrip(
        request("http://local/api/skill/trips/workspace-trip", { workspaceId: guestId }),
        { params: Promise.resolve({ id: "workspace-trip" }) },
      );
      const denied = await getSkillTrip(
        request("http://local/api/skill/trips/other-workspace-trip", { workspaceId: guestId }),
        { params: Promise.resolve({ id: "other-workspace-trip" }) },
      );

      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ ok: true, trip: { id: "workspace-trip", title: "Current workspace trip" } });
      expect(denied.status).toBe(404);
    });
  });

  describe("POST /api/voyage/import", () => {
    it("returns an existing trip from the current workspace", async () => {
      await storeTrip(guestRoot(), "workspace-trip", "Current workspace trip");

      const response = await importTrip(request("http://local/api/voyage/import", {
        method: "POST",
        workspaceId: guestId,
        body: { tripId: "workspace-trip" },
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, trip: { id: "workspace-trip", title: "Current workspace trip" } });
    });

    it("does not import a normal trip from the global base repository", async () => {
      await storeTrip(dataDir, "global-private-trip", "Global private trip");

      const response = await importTrip(request("http://local/api/voyage/import", {
        method: "POST",
        workspaceId: guestId,
        body: { tripId: "global-private-trip" },
      }));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ ok: false, error: "TRIP_NOT_FOUND" });
      expect(await new JsonSkillRepository(guestRoot()).getTrip("global-private-trip")).toBeNull();
    });

    it("seeds only the allowlisted demo trip when demo mode is enabled", async () => {
      process.env.VOYAGE_DEMO_MODE = "true";

      const response = await importTrip(request("http://local/api/voyage/import", {
        method: "POST",
        workspaceId: guestId,
        body: { tripId: DEMO_TRIP_ID },
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, trip: { id: DEMO_TRIP_ID } });
      expect((await new JsonSkillRepository(guestRoot()).getTrip(DEMO_TRIP_ID))?.trip.id).toBe(DEMO_TRIP_ID);
    });

    it("does not seed the demo trip when demo mode is disabled", async () => {
      await storeTrip(dataDir, DEMO_TRIP_ID, "Global demo fixture");

      const response = await importTrip(request("http://local/api/voyage/import", {
        method: "POST",
        workspaceId: guestId,
        body: { tripId: DEMO_TRIP_ID },
      }));

      expect(response.status).toBe(404);
      expect(await new JsonSkillRepository(guestRoot()).getTrip(DEMO_TRIP_ID)).toBeNull();
    });
  });
});
