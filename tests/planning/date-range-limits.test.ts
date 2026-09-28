// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createPlanningSession } from "@/app/api/voyage/planning/session/route";
import { POST as messagePlanningSession } from "@/app/api/voyage/planning/session/[id]/message/route";
import { POST as generatePlanningSession } from "@/app/api/voyage/planning/session/[id]/generate/route";
import { planningProfileSchema } from "@/schemas/planning";
import { dateRangeIssue, mergePlanningProfiles } from "@/services/planning/profile";
import { JsonSkillRepository } from "@/skill/repository";

const workspaceId = "66666666-6666-4666-8666-666666666666";
const originalDataDir = process.env.VOYAGE_DATA_DIR;
const originalFixture = process.env.VOYAGE_PROVIDER_FIXTURE;
const originalAllowMock = process.env.VOYAGE_ALLOW_MOCK;
const originalLlm = process.env.VOYAGE_LLM_ENABLED;
let dataDir: string;

function request(url: string, body: unknown) {
  const headers = new Headers({
    cookie: `voyage_guest_workspace=${workspaceId}`,
    "content-type": "application/json",
  });
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("planning profile stays representable", () => {
  // The reported failure: a departure a year before the return date produced
  // days:365, and that profile was rejected by its own schema — surfacing in the
  // chat as `[{"code":"too_big","maximum":31,"path":["days"]}]`.
  it("never returns a profile its own schema rejects, for any date span", () => {
    const cases = [
      ["2025-10-01", "2026-09-30"],
      ["2026-09-28", "2026-10-01"],
      ["2026-09-28", "2026-09-28"],
      ["2026-09-28", "2027-12-31"],
    ] as const;

    for (const [startDate, endDate] of cases) {
      const merged = mergePlanningProfiles({ destination: "深圳" }, { startDate, endDate });
      expect(() => planningProfileSchema.parse(merged)).not.toThrow();
      if (merged.days !== undefined) {
        expect(merged.days).toBeGreaterThan(0);
        expect(merged.days).toBeLessThanOrEqual(31);
      }
    }
  });

  it("reports an over-long span instead of silently clamping it", () => {
    const merged = mergePlanningProfiles(
      { destination: "深圳" },
      { startDate: "2025-10-01", endDate: "2026-09-30" },
    );
    // Nothing is invented: the dates stay exactly as the traveller set them.
    expect(merged.startDate).toBe("2025-10-01");
    expect(merged.endDate).toBe("2026-09-30");
    expect(merged.days).toBeUndefined();

    const issue = dateRangeIssue(merged, "2026-09-28");
    expect(issue?.code).toBe("span_too_long");
    expect(issue?.message).toContain("365");
    expect(issue?.message).toContain("上限");
  });

  it("treats a normal span as usable and a past departure as a warning only", () => {
    const good = mergePlanningProfiles({ destination: "南京" }, { startDate: "2026-09-28", endDate: "2026-10-01" });
    expect(good.days).toBe(4);
    expect(dateRangeIssue(good, "2026-09-28")).toBeUndefined();

    const past = mergePlanningProfiles({ destination: "南京" }, { startDate: "2025-01-01", endDate: "2025-01-03" });
    expect(dateRangeIssue(past, "2026-09-28")?.code).toBe("past_departure");
    expect(past.days).toBe(3);
  });

  it("heals a stored profile that already holds an unrepresentable day count", () => {
    // A session written by the older code must still open rather than strand the
    // whole conversation.
    const healed = mergePlanningProfiles(
      { destination: "深圳", days: 365, startDate: "2025-10-01", endDate: "2026-09-30" },
      {},
    );
    expect(healed.days).toBeUndefined();
    expect(() => planningProfileSchema.parse(healed)).not.toThrow();
  });
});

describe("planning API surfaces readable errors", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-planning-range-"));
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

  it("accepts a year-long date range as a conversation turn without leaking a Zod error", async () => {
    const created = await createPlanningSession(request("http://local/api/voyage/planning/session", {
      prompt: "我想国庆去深圳旅游",
    }));
    const session = await created.json() as { data: { sessionId: string; revision: number } };

    // This is exactly the request that produced the raw Zod dump in the chat:
    // the panel's dates are sent alongside a message that states no day count.
    const response = await messagePlanningSession(request("http://local/api/voyage/planning/session/x/message", {
      message: "日期先这样",
      expectedRevision: session.data.revision,
      profile: { startDate: "2025-10-01", endDate: "2026-09-30" },
    }), context(session.data.sessionId));

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      ok: boolean;
      data: { profile: { days?: number; startDate?: string; endDate?: string }; missingFields: string[]; ready: boolean };
    };
    expect(payload.ok).toBe(true);
    // Nothing is silently fixed: the traveller's dates are kept as entered, and
    // the planner keeps treating the dates as unsettled.
    expect(payload.data.profile.startDate).toBe("2025-10-01");
    expect(payload.data.profile.endDate).toBe("2026-09-30");
    expect(payload.data.profile.days).toBeUndefined();
    expect(payload.data.missingFields).toContain("dates");
    expect(payload.data.ready).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("too_big");
    expect(JSON.stringify(payload)).not.toContain("maximum");
  });

  it("honours a day count stated in the same turn as the bad dates", async () => {
    const created = await createPlanningSession(request("http://local/api/voyage/planning/session", {
      prompt: "我想国庆去深圳旅游",
    }));
    const session = await created.json() as { data: { sessionId: string; revision: number } };

    // The reported screenshot said "先按 3 天安排" while the panel held a
    // year-long range: the stated length must win and move the return date.
    const response = await messagePlanningSession(request("http://local/api/voyage/planning/session/x/message", {
      message: "先按 3 天安排",
      expectedRevision: session.data.revision,
      profile: { startDate: "2025-10-01", endDate: "2026-09-30" },
    }), context(session.data.sessionId));

    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { profile: { days?: number; endDate?: string }; missingFields: string[] } };
    expect(payload.data.profile.days).toBe(3);
    expect(payload.data.profile.endDate).toBe("2025-10-03");
    expect(payload.data.missingFields).not.toContain("dates");
    expect(JSON.stringify(payload)).not.toContain("too_big");
  });

  it("refuses to generate from an unrepresentable range with a readable reason", async () => {
    const created = await createPlanningSession(request("http://local/api/voyage/planning/session", {
      prompt: "我想国庆去深圳旅游",
      profile: { destination: "深圳", travelers: 2, budget: 2500 },
    }));
    const session = await created.json() as { data: { sessionId: string; revision: number } };

    const patched = await messagePlanningSession(request("http://local/api/voyage/planning/session/x/message", {
      message: "日期先这样",
      expectedRevision: session.data.revision,
      profile: { startDate: "2025-10-01", endDate: "2026-09-30" },
    }), context(session.data.sessionId));
    expect(patched.status).toBe(200);
    const afterMessage = await patched.json() as { data: { revision: number } };

    const generated = await generatePlanningSession(request("http://local/api/voyage/planning/session/x/generate", {
      expectedRevision: afterMessage.data.revision,
      confirmed: true,
    }), context(session.data.sessionId));

    expect(generated.status).toBe(422);
    const payload = await generated.json() as { ok: boolean; error: { code: string; message: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toContain("最多支持");
    expect(payload.error.message).not.toContain("too_big");
    expect(JSON.stringify(payload)).not.toContain("maximum");

    // The range is rejected before the session is locked into "generating", so
    // nothing was queried, no trip was written, and the traveller can fix the
    // dates and generate again without losing the conversation.
    const repository = new JsonSkillRepository(path.join(dataDir, "guests", workspaceId));
    const stored = await repository.getPlanningSession(session.data.sessionId);
    expect(stored?.status).toBe("collecting");
    expect(stored?.tripId).toBeUndefined();
    expect(await repository.listTrips()).toHaveLength(0);
  });
});
