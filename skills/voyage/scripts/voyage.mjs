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

function runNpm(args, cwd) {
  const adjacentCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (process.platform === "win32" && existsSync(adjacentCli)) {
    run(process.execPath, [adjacentCli, ...args], { cwd });
    return;
  }
  run("npm", args, { cwd });
}

async function installRuntime(target) {
  if (!lock.commit || lock.commit === "__RUNTIME_COMMIT__") {
    throw new Error("Voyage runtime lock has not been finalized");
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.install-${process.pid}`;
  if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  process.stderr.write(`Installing Voyage runtime ${lock.commit.slice(0, 12)}…\n`);
  try {
    await mkdir(temporary, { recursive: true });
    run("git", ["-C", temporary, "init"]);
    run("git", ["-C", temporary, "remote", "add", "origin", lock.repository]);
    run("git", ["-C", temporary, "fetch", "--depth", "1", "origin", lock.commit]);
    run("git", ["-C", temporary, "checkout", "--detach", "FETCH_HEAD"]);
    runNpm(["ci", "--ignore-scripts"], temporary);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    const { rename } = await import("node:fs/promises");
    await rename(temporary, target);
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const callerCwd = process.cwd();
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
  if (!existsSync(tsxCli)) {
    runNpm(["ci", "--ignore-scripts"], runtime);
  }
  const forwarded = process.argv.slice(2);
  const inputIndex = forwarded.indexOf("--input");
  if (inputIndex >= 0 && forwarded[inputIndex + 1] && forwarded[inputIndex + 1] !== "-") {
    forwarded[inputIndex + 1] = path.resolve(callerCwd, forwarded[inputIndex + 1]);
  }
  const childEnv = {
    ...process.env,
    VOYAGE_DATA_DIR: process.env.VOYAGE_DATA_DIR || path.join(callerCwd, ".voyage"),
  };
  const result = spawnSync(process.execPath, [tsxCli, path.join(runtime, "src", "skill", "cli.ts"), ...forwarded], {
    cwd: runtime,
    env: childEnv,
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
