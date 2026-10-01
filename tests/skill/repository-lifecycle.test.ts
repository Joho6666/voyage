// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonSkillRepository } from "@/skill/repository";
import { chongqingTrip } from "@/data/demo/chongqing";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "voyage-repo-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("JsonSkillRepository proposal lifecycle", () => {
  const proposalFixture = (tripId: string, baseRevision: number, baseHash: string) => ({
    tripId,
    baseRevision,
    baseHash,
    actions: [],
    proposedTrip: structuredClone(chongqingTrip),
    changeSet: { summary: "noop", proposedTrip: structuredClone(chongqingTrip) } as never,
  });

  it("deletes a proposal once it has been applied", async () => {
    const repository = new JsonSkillRepository(dataDir);
    const stored = await repository.createTrip(structuredClone(chongqingTrip));
    const { record: proposal, token } = await repository.saveProposal(proposalFixture(chongqingTrip.id, stored.revision, stored.hash));

    const filesBefore = await readdir(path.join(dataDir, "proposals"));
    expect(filesBefore).toContain(`${proposal.id}.json`);

    await repository.applyProposal({ tripId: chongqingTrip.id, proposalId: proposal.id, expectedTripRevision: stored.revision, confirmed: true, proposalToken: token });

    // A consumed proposal embeds a whole proposed trip; leaving the file
    // behind made proposals/ grow without bound.
    const filesAfter = await readdir(path.join(dataDir, "proposals"));
    expect(filesAfter).not.toContain(`${proposal.id}.json`);
  });

  it("cascades proposal cleanup when the trip is deleted", async () => {
    const repository = new JsonSkillRepository(dataDir);
    const stored = await repository.createTrip(structuredClone(chongqingTrip));
    const { record: proposal } = await repository.saveProposal(proposalFixture(chongqingTrip.id, stored.revision, stored.hash));

    await repository.deleteTrip(chongqingTrip.id);
    const files = await readdir(path.join(dataDir, "proposals"));
    expect(files).not.toContain(`${proposal.id}.json`);
  });

  it("keeps traversal-shaped record ids from escaping the workspace", async () => {
    const repository = new JsonSkillRepository(dataDir);
    // encodeURIComponent escapes the traversal, so the id simply misses
    // rather than reading another directory's record.
    await expect(repository.getTrip("../../secrets")).resolves.toBeNull();
    // And a genuine read still works.
    await repository.createTrip(structuredClone(chongqingTrip));
    await expect(repository.getTrip(chongqingTrip.id)).resolves.toMatchObject({ revision: 1 });
  });
});
