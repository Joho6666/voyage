import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configurationPresence,
  readLocalCredentials,
  removeLocalCredential,
  runtimeConfig,
  runtimeConfigSync,
  saveLocalCredential,
  saveLocalCredentials,
} from "@/services/config/local-credentials";

const originalCwd = process.cwd();
const originalEnv: Record<string, string | undefined> = {};
let workDir: string;

function setEnv(name: string, value: string | undefined) {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function credentialsPath() {
  return path.join(workDir, ".voyage", "local-credentials.json");
}

describe.sequential("local-credentials file store", () => {
  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "voyage-local-credentials-"));
    process.chdir(workDir);
    setEnv("VOYAGE_SKIP_LOCAL_CREDENTIALS", undefined);
    setEnv("LLM_MODEL", undefined);
    setEnv("AMAP_SERVER_KEY", undefined);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(originalEnv)) setEnv(name, value);
  });

  it("round-trips a saved credential through the atomic file store", async () => {
    await saveLocalCredential("LLM_API_KEY", "sk-test-123");
    const stored = JSON.parse(await readFile(credentialsPath(), "utf8")) as Record<string, string>;
    expect(stored.LLM_API_KEY).toBe("sk-test-123");
    expect((await readLocalCredentials()).LLM_API_KEY).toBe("sk-test-123");
    // Secrets on disk: owner-only permissions, no group/world read.
    const mode = (await stat(credentialsPath())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("rejects unknown keys, oversized values and newline injection", async () => {
    await expect(saveLocalCredential("NOT_EDITABLE", "x")).rejects.toThrow("Unknown configuration field");
    await expect(saveLocalCredential("LLM_API_KEY", "x".repeat(4097))).rejects.toThrow("Invalid configuration value");
    await expect(saveLocalCredential("LLM_API_KEY", "line1\nline2")).rejects.toThrow("Invalid configuration value");
    await expect(saveLocalCredentials({ LLM_API_KEY: "ok\0bad" })).rejects.toThrow("Invalid configuration value");
    await expect(readLocalCredentials()).resolves.toEqual({});
  });

  it("removes a key by clearing it and keeps other keys intact", async () => {
    await saveLocalCredentials({ LLM_API_KEY: "sk-a", LLM_MODEL: "qwen-plus" });
    await removeLocalCredential("LLM_API_KEY");
    const stored = await readLocalCredentials();
    expect(stored.LLM_API_KEY).toBeUndefined();
    expect(stored.LLM_MODEL).toBe("qwen-plus");
  });

  it("prefers the file over environment and falls back to env when absent", async () => {
    setEnv("LLM_MODEL", "env-model");
    expect(await runtimeConfig("LLM_MODEL")).toBe("env-model");
    expect(runtimeConfigSync("LLM_MODEL")).toBe("env-model");
    await saveLocalCredential("LLM_MODEL", "file-model");
    expect(await runtimeConfig("LLM_MODEL")).toBe("file-model");
    expect(runtimeConfigSync("LLM_MODEL")).toBe("file-model");
  });

  it("ignores the file store entirely under VOYAGE_SKIP_LOCAL_CREDENTIALS=1", async () => {
    await mkdir(path.dirname(credentialsPath()), { recursive: true });
    await writeFile(credentialsPath(), JSON.stringify({ LLM_MODEL: "file-model" }), "utf8");
    setEnv("VOYAGE_SKIP_LOCAL_CREDENTIALS", "1");
    setEnv("LLM_MODEL", "env-model");
    expect(await runtimeConfig("LLM_MODEL")).toBe("env-model");
  });

  it("reports presence from both file and environment", async () => {
    expect(await configurationPresence()).toMatchObject({ LLM_MODEL: false, AMAP_SERVER_KEY: false });
    setEnv("AMAP_SERVER_KEY", "env-key");
    await saveLocalCredential("LLM_MODEL", "file-model");
    const presence = await configurationPresence();
    expect(presence.LLM_MODEL).toBe(true);
    expect(presence.AMAP_SERVER_KEY).toBe(true);
  });

  it("drops values that are not strings or not editable keys when reading", async () => {
    await mkdir(path.dirname(credentialsPath()), { recursive: true });
    await writeFile(credentialsPath(), JSON.stringify({ LLM_MODEL: 42, EVIL_KEY: "x", LLM_API_KEY: "sk-ok" }), "utf8");
    const stored = await readLocalCredentials();
    expect(stored).toEqual({ LLM_API_KEY: "sk-ok" });
  });
});
