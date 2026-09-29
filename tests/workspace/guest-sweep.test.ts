import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepStaleGuests } from "@/app/api/voyage/workspace";

// Only these fixture ids are ever joined into paths — the whitelist check
// below refuses anything else, so no traversal input can reach the filesystem.
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let guestsRoot: string;
let previousTtl: string | undefined;

beforeEach(async () => {
  guestsRoot = await mkdtemp(path.join(tmpdir(), "voyage-sweep-"));
  previousTtl = process.env.VOYAGE_GUEST_TTL_DAYS;
  delete process.env.VOYAGE_GUEST_TTL_DAYS;
});

afterEach(async () => {
  if (previousTtl === undefined) delete process.env.VOYAGE_GUEST_TTL_DAYS;
  else process.env.VOYAGE_GUEST_TTL_DAYS = previousTtl;
  await rm(guestsRoot, { recursive: true, force: true });
});

function guestDir(id: string) {
  if (!UUID_PATTERN.test(id)) throw new Error("fixture id must be a whitelisted uuid");
  return path.join(guestsRoot, id);
}

async function seedGuest(id: string, subdirs: string[], extraFiles: string[] = []) {
  const dir = guestDir(id);
  for (const subdir of subdirs) await mkdir(path.join(dir, subdir), { recursive: true });
  for (const file of extraFiles) await writeFile(path.join(dir, file), "x");
  return dir;
}

async function ageDirRecursively(dir: string, daysAgo: number) {
  const stamp = new Date(Date.now() - daysAgo * 86_400_000);
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    await utimes(current, stamp, stamp);
    const dirents = await readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = path.join(current, dirent.name);
      await utimes(child, stamp, stamp);
      if (dirent.isDirectory()) stack.push(child);
    }
  }
}

describe("stale guest workspace sweep", () => {
  it("removes idle guest workspaces and keeps fresh ones", async () => {
    const stale = await seedGuest(UUID_A, ["trips"]);
    await writeFile(path.join(stale, "trips", "trip.json"), "{}");
    await ageDirRecursively(stale, 40);
    const fresh = await seedGuest(UUID_B, ["planning-sessions"]);
    await ageDirRecursively(fresh, 3);

    const removed = await sweepStaleGuests({ guestsRoot });
    expect(removed).toEqual([UUID_A]);
    await expect(readdir(stale)).rejects.toThrow();
    await expect(readdir(fresh)).resolves.toBeDefined();
  });

  it("never removes the caller's own workspace even when idle", async () => {
    const current = await seedGuest(UUID_A, ["trips"]);
    await ageDirRecursively(current, 90);

    const removed = await sweepStaleGuests({ guestsRoot, keepWorkspaceId: UUID_A });
    expect(removed).toEqual([]);
    await expect(readdir(current)).resolves.toBeDefined();
  });

  it("skips directories that do not look like guest workspaces", async () => {
    const foreign = await seedGuest(UUID_A, ["trips"], ["desktop.ini"]);
    await ageDirRecursively(foreign, 90);
    const wrongName = path.join(guestsRoot, "not-a-uuid");
    await mkdir(wrongName);
    await ageDirRecursively(wrongName, 90);

    const removed = await sweepStaleGuests({ guestsRoot });
    expect(removed).toEqual([]);
    await expect(readdir(foreign)).resolves.toBeDefined();
    await expect(readdir(wrongName)).resolves.toBeDefined();
  });

  it("respects VOYAGE_GUEST_TTL_DAYS=0 as a disable switch", async () => {
    const stale = await seedGuest(UUID_A, ["trips"]);
    await ageDirRecursively(stale, 400);
    process.env.VOYAGE_GUEST_TTL_DAYS = "0";

    const removed = await sweepStaleGuests({ guestsRoot });
    expect(removed).toEqual([]);
    await expect(readdir(stale)).resolves.toBeDefined();
  });

  it("sweeps several idle workspaces in one pass", async () => {
    for (const id of [UUID_A, UUID_B, UUID_C, UUID_D]) {
      const dir = await seedGuest(id, ["proposals"]);
      await ageDirRecursively(dir, 60);
    }
    const removed = await sweepStaleGuests({ guestsRoot, keepWorkspaceId: UUID_C });
    expect(removed.sort()).toEqual([UUID_A, UUID_B, UUID_D].sort());
  });
});
