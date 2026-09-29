import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepExpiredShares } from "@/app/api/voyage/workspace";

let sharesDir: string;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "voyage-shares-"));
  sharesDir = path.join(root, "shares");
  await mkdir(sharesDir, { recursive: true });
});

afterEach(async () => {
  await rm(path.dirname(sharesDir), { recursive: true, force: true });
});

async function seedShare(token: string, expiresAt: number) {
  await writeFile(path.join(sharesDir, `${token}.json`), JSON.stringify({ token, trip: {}, expiresAt }), "utf8");
}

describe("expired share sweep", () => {
  it("removes expired share files and keeps fresh and foreign entries", async () => {
    await seedShare("11111111-1111-4111-8111-111111111111", Date.now() - 1000);
    await seedShare("22222222-2222-4222-8222-222222222222", Date.now() + 86_400_000);
    await writeFile(path.join(sharesDir, "notes.txt"), "not a share", "utf8");
    await writeFile(path.join(sharesDir, "broken.json"), "{not json", "utf8");

    const removed = await sweepExpiredShares({ sharesDir });
    expect(removed).toBe(1);

    const remaining = await readdir(sharesDir);
    expect(remaining).toContain("22222222-2222-4222-8222-222222222222.json");
    expect(remaining).toContain("notes.txt");
    expect(remaining).toContain("broken.json");
    expect(remaining).not.toContain("11111111-1111-4111-8111-111111111111.json");
  });

  it("removes nothing when the directory is missing", async () => {
    const removed = await sweepExpiredShares({ sharesDir: path.join(sharesDir, "does-not-exist") });
    expect(removed).toBe(0);
  });
});
