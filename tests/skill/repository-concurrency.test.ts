// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip } from "@/data/demo/chongqing";

let dataDir: string;
let repository: JsonSkillRepository;

describe("repository per-record write lock", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-write-lock-"));
    repository = new JsonSkillRepository(dataDir);
    await repository.createTrip(structuredClone(chongqingTrip));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("serializes concurrent updateTrip: same expectedRevision yields one win and one REVISION_CONFLICT", async () => {
    const a = structuredClone(chongqingTrip);
    a.title = "A 的修改";
    const b = structuredClone(chongqingTrip);
    b.title = "B 的修改";

    // Without the per-record lock both writers read revision 1, both passed
    // the check, and the later rename silently dropped the other update.
    const results = await Promise.allSettled([
      repository.updateTrip({ tripId: chongqingTrip.id, expectedRevision: 1, trip: a }),
      repository.updateTrip({ tripId: chongqingTrip.id, expectedRevision: 1, trip: b }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "REVISION_CONFLICT" });

    const stored = await repository.getTrip(chongqingTrip.id);
    expect(stored?.revision).toBe(2);
    // The surviving write is one of the two contenders, fully intact.
    expect([a.title, b.title]).toContain(stored?.trip.title);
  });

  it("lets sequential writers with refreshed revisions both land", async () => {
    const first = await repository.updateTrip({
      tripId: chongqingTrip.id,
      expectedRevision: 1,
      trip: { ...structuredClone(chongqingTrip), title: "第一次修改" },
    });
    expect(first.revision).toBe(2);
    const second = await repository.updateTrip({
      tripId: chongqingTrip.id,
      expectedRevision: 2,
      trip: { ...structuredClone(chongqingTrip), title: "第二次修改" },
    });
    expect(second.revision).toBe(3);
    expect((await repository.getTrip(chongqingTrip.id))?.trip.title).toBe("第二次修改");
  });
});
