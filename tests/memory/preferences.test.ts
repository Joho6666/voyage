// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreferenceMemoryStore } from "@/services/memory/preferences";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";

describe("preference memory store (Phase 6.9)", () => {
  let root: string;
  let store: PreferenceMemoryStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "voyage-memory-"));
    store = new PreferenceMemoryStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores explicit statements and supersedes same-key inferences", async () => {
    await store.recordInference("pace", "relaxed", "连续 2 天每天只排 2-3 站");
    await store.setExplicit("pace", "relaxed", "用户原话：喜欢轻松一点");
    const memory = await store.read();
    expect(memory.explicit).toHaveLength(1);
    expect(memory.inferred).toHaveLength(0);
  });

  it("grows inference confidence with consistent samples, with a ceiling", async () => {
    await store.recordInference("walkingTolerance", "low", "拒绝 9km 步行方案");
    await store.recordInference("walkingTolerance", "low", "再次选择打车");
    await store.recordInference("walkingTolerance", "low", "第三次选择少走");
    const memory = await store.read();
    const entry = memory.inferred.find((candidate) => candidate.key === "walkingTolerance");
    expect(entry?.samples).toBe(3);
    expect(entry?.confidence).toBeCloseTo(0.6);
    expect(entry?.evidence).toHaveLength(3);
  });

  it("resets an inference when behaviour contradicts it", async () => {
    await store.recordInference("transportPreference", "public", "选了地铁");
    await store.recordInference("transportPreference", "public", "又选了地铁");
    await store.recordInference("transportPreference", "taxi", "改选打车");
    const memory = await store.read();
    const entry = memory.inferred.find((candidate) => candidate.key === "transportPreference");
    expect(entry?.value).toBe("taxi");
    expect(entry?.samples).toBe(1);
    expect(entry?.confidence).toBeCloseTo(0.3);
  });

  it("decays stale inferences and drops the unusable ones", async () => {
    await store.recordInference("wakeTime", "08:00", "连续晚出发", "2026-08-01T00:00:00Z");
    const decayed = await store.decay(Date.parse("2026-10-03T00:00:00Z"));
    expect(decayed.inferred).toHaveLength(0);
  });

  it("deletes a key from both stores and supports disabling", async () => {
    await store.setExplicit("budgetStyle", "性价比优先", "用户原话");
    await store.recordInference("travelStyle", "citywalk", "偏好街区漫步");
    await store.remove("budgetStyle");
    const memory = await store.read();
    expect(memory.explicit).toHaveLength(0);
    expect(memory.inferred).toHaveLength(1);

    const disabled = await store.setDisabled(true);
    expect(disabled.disabledAt).toBeTruthy();
    expect(await store.summaryLine()).toBeNull();
    const enabled = await store.setDisabled(false);
    expect(enabled.disabledAt).toBeUndefined();
  });

  it("disclosure line marks explicit vs inferred with confidence", async () => {
    expect(await store.summaryLine()).toBeNull();
    await store.setExplicit("pace", "relaxed", "用户原话");
    await store.recordInference("walkingTolerance", "low", "拒绝长步行");
    const line = await store.summaryLine();
    expect(line).toContain("根据你的旅行偏好");
    expect(line).toContain("你自己告知的");
    expect(line).toContain("可信度 0.30");
  });
});

describe("traveler memory runtime commands", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-memory-rt-"));
    runtime = new VoyageSkillRuntime(new JsonSkillRepository(dataDir));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("round-trips through update/get/delete", async () => {
    const updated = await runtime.execute("update-traveler-memory", {
      entries: [{ key: "pace", value: "relaxed", source: "用户原话：慢一点" }],
    }) as { data: { memory: { explicit: unknown[] }; disclosure: string } };
    expect(updated.data.memory.explicit).toHaveLength(1);
    expect(updated.data.disclosure).toContain("根据你的旅行偏好");

    const got = await runtime.execute("get-traveler-memory", {}) as { data: { memory: { explicit: Array<{ key: string }> } } };
    expect(got.data.memory.explicit[0].key).toBe("pace");

    const deleted = await runtime.execute("delete-traveler-memory", { key: "pace" }) as { data: { deletedKey: string } };
    expect(deleted.data.deletedKey).toBe("pace");
    const empty = await runtime.execute("get-traveler-memory", {}) as { data: { disclosure: string | null } };
    expect(empty.data.disclosure).toBeNull();
  });

  it("disables and re-enables memory", async () => {
    await runtime.execute("update-traveler-memory", { entries: [{ key: "budgetStyle", value: "省钱优先" }] });
    await runtime.execute("disable-traveler-memory", { disabled: true });
    const disabled = await runtime.execute("get-traveler-memory", {}) as { data: { disclosure: string | null; memory: { disabledAt?: string } } };
    expect(disabled.data.memory.disabledAt).toBeTruthy();
    expect(disabled.data.disclosure).toBeNull();
    await runtime.execute("disable-traveler-memory", { disabled: false });
    const enabled = await runtime.execute("get-traveler-memory", {}) as { data: { disclosure: string | null } };
    expect(enabled.data.disclosure).not.toBeNull();
  });
});
