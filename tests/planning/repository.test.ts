// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planningSessionSchema } from "@/schemas/planning";
import { JsonSkillRepository } from "@/skill/repository";

let root: string;

describe("planning session repository", () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "voyage-planning-repository-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function session(id = "planning-test") {
    const timestamp = "2030-05-01T00:00:00.000Z";
    return planningSessionSchema.parse({
      id,
      workspaceId: "workspace-a",
      revision: 1,
      profile: {
        destination: "重庆",
        days: 3,
        travelers: 2,
        budget: 3000,
        vibes: ["美食"],
        mustVisit: [],
        avoid: [],
        dietary: [],
        socialOptIn: false,
        includeExternalOffers: false,
      },
      messages: [],
      status: "ready",
      missingFields: [],
      suggestedReplies: ["可以生成路线了"],
      conflicts: [],
      llmStatus: "skipped",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  it("round-trips a schema-validated session and increments revision atomically", async () => {
    const repository = new JsonSkillRepository(root);
    const created = await repository.createPlanningSession(session());
    expect(created.revision).toBe(1);
    expect(created.hash).toHaveLength(64);

    const updated = await repository.updatePlanningSession({
      sessionId: created.id,
      expectedRevision: created.revision,
      session: { ...session(), summary: "已确认重庆三日轻松美食行程" },
    });
    expect(updated.revision).toBe(2);
    expect(updated.summary).toContain("重庆三日");
    expect((await repository.getPlanningSession(created.id))?.hash).toBe(updated.hash);
  });

  it("rejects a stale revision without overwriting the current session", async () => {
    const repository = new JsonSkillRepository(root);
    const created = await repository.createPlanningSession(session());
    await repository.updatePlanningSession({
      sessionId: created.id,
      expectedRevision: 1,
      session: { ...session(), summary: "first update" },
    });

    await expect(repository.updatePlanningSession({
      sessionId: created.id,
      expectedRevision: 1,
      session: { ...session(), summary: "stale update" },
    })).rejects.toThrow("revision");
    expect((await repository.getPlanningSession(created.id))?.summary).toBe("first update");
  });
});
