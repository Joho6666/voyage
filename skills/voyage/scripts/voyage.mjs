#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, "..");
const lock = JSON.parse(readFileSync(path.join(skillRoot, "runtime.lock.json"), "utf8"));

function isRuntime(root) {
  return existsSync(path.join(root, "package.json")) && existsSync(path.join(root, "src", "skill", "cli.ts"));
}

function findContainingRuntime() {
  let cursor = skillRoot;
  while (path.dirname(cursor) !== cursor) {
    if (isRuntime(cursor)) return cursor;
    cursor = path.dirname(cursor);
  }
  return null;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { stdio: "inherit", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} exited with ${result.status ?? "unknown"}`);
}

async function installRuntime(target) {
  if (!lock.commit || lock.commit === "__RUNTIME_COMMIT__") {
    throw new Error("Voyage runtime lock has not been finalized");
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.install-${process.pid}`;
  if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  process.stderr.write(`Installing Voyage runtime ${lock.commit.slice(0, 12)}…\n`);
  run("git", ["clone", "--filter=blob:none", "--no-checkout", lock.repository, temporary]);
  run("git", ["-C", temporary, "fetch", "--depth", "1", "origin", lock.commit]);
  run("git", ["-C", temporary, "checkout", "--detach", lock.commit]);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts"], { cwd: temporary });
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  const { rename } = await import("node:fs/promises");
  await rename(temporary, target);
}

async function main() {
  const override = process.env.VOYAGE_REPO ? path.resolve(process.env.VOYAGE_REPO) : null;
  let runtime = override && isRuntime(override) ? override : findContainingRuntime();
  if (!runtime) {
    const cacheBase = process.env.VOYAGE_SKILL_CACHE
      ? path.resolve(process.env.VOYAGE_SKILL_CACHE)
      : path.join(process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "voyage-skill");
    runtime = path.join(cacheBase, lock.commit);
    if (!isRuntime(runtime)) await installRuntime(runtime);
  }
  const tsxCli = path.join(runtime, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(tsxCli)) run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts"], { cwd: runtime });
  const result = spawnSync(process.execPath, [tsxCli, path.join(runtime, "src", "skill", "cli.ts"), ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ schemaVersion: "voyage.skill.v1", ok: false, error: { code: "RUNTIME_INSTALL_FAILED", message } })}\n`);
  process.exitCode = 1;
});
