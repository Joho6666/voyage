import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getShare, POST as createShare } from "@/app/api/voyage/share/route";
import { chongqingTrip } from "@/data/demo/chongqing";
import { JsonSkillRepository } from "@/skill/repository";
import type { Trip } from "@/types/travel";

const guestId = "33333333-3333-4333-8333-333333333333";
const originalDataDir = process.env.VOYAGE_DATA_DIR;
let dataDir: string;

function guestRoot() {
  return path.join(dataDir, "guests", guestId);
}

function shareRequest(token: string) {
  return new NextRequest(`http://local/api/voyage/share?token=${encodeURIComponent(token)}`, { method: "GET" });
}

describe.sequential("POST + GET /api/voyage/share", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-share-route-"));
    process.env.VOYAGE_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.VOYAGE_DATA_DIR;
    else process.env.VOYAGE_DATA_DIR = originalDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates a share and serves the whitelisted public trip back", async () => {
    const trip = structuredClone(chongqingTrip) as Trip;
    trip.id = "share-me";
    trip.prompt = "内部原始提示词";
    await new JsonSkillRepository(guestRoot()).createTrip(trip);

    const request = new NextRequest("http://local/api/voyage/share", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", cookie: `voyage_guest_workspace=${guestId}` }),
      body: JSON.stringify({ tripId: "share-me" }),
    });
    const created = await createShare(request);
    expect(created.status).toBe(200);
    const { token, expiresAt } = await created.json() as { token: string; expiresAt: number };
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const served = await getShare(shareRequest(token));
    expect(served.status).toBe(200);
    const body = await served.json() as { ok: boolean; trip: Trip };
    expect(body.ok).toBe(true);
    expect(body.trip.id).toBe("share-me");
    expect(body.trip.prompt).toBe("");
    expect(body.trip.budgetItems).toEqual([]);
    expect(body.trip.tasks).toEqual([]);
  });

  it("rejects a share request without a tripId", async () => {
    const request = new NextRequest("http://local/api/voyage/share", { method: "POST", body: JSON.stringify({}) });
    const response = await createShare(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });

  it("rejects a share request for a trip outside the workspace", async () => {
    const request = new NextRequest("http://local/api/voyage/share", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", cookie: `voyage_guest_workspace=${guestId}` }),
      body: JSON.stringify({ tripId: "not-mine" }),
    });
    const response = await createShare(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: "TRIP_NOT_FOUND" });
  });

  it("rejects a malformed token on read", async () => {
    const response = await getShare(shareRequest("../escape"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });

  it("returns 404 for an unknown token without leaking the token", async () => {
    const response = await getShare(shareRequest("00000000-0000-4000-8000-000000000000"));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: "SHARE_NOT_FOUND" });
  });

  it("returns 410 once the share file has expired", async () => {
    const token = "11111111-2222-4333-8444-555555555555";
    const sharesDir = path.join(dataDir, "shares");
    await mkdir(sharesDir, { recursive: true });
    await writeFile(path.join(sharesDir, `${token}.json`), JSON.stringify({ token, trip: { id: "old" }, expiresAt: Date.now() - 1000 }), "utf8");
    const response = await getShare(shareRequest(token));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ ok: false, error: "SHARE_EXPIRED" });
  });
});
