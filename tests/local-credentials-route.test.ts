import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/services/config/local-credentials", () => ({
  configurationPresence: vi.fn(async () => ({ LLM_API_KEY: true })),
  removeLocalCredential: vi.fn(async () => {}),
  saveLocalCredential: vi.fn(async () => {}),
  saveLocalCredentials: vi.fn(async () => {}),
}));

import {
  removeLocalCredential,
  saveLocalCredential,
  saveLocalCredentials,
} from "@/services/config/local-credentials";
import { DELETE, GET, POST } from "@/app/api/voyage/local-credentials/route";

const originalEnv: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined) {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function request(url: string, options: { method?: string; origin?: string | null; body?: unknown } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe.sequential("local-credentials route gate matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv("VOYAGE_LOCAL_SETTINGS_ENABLED", "1");
    setEnv("VERCEL", undefined);
    setEnv("CI", undefined);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) setEnv(name, value);
  });

  it("rejects GET when the settings switch is off", async () => {
    setEnv("VOYAGE_LOCAL_SETTINGS_ENABLED", undefined);
    const response = await GET(request("http://localhost:3000/api/voyage/local-credentials"));
    expect(response.status).toBe(403);
  });

  it("rejects GET on Vercel or CI regardless of the switch", async () => {
    setEnv("VERCEL", "1");
    expect((await GET(request("http://localhost:3000/api/voyage/local-credentials"))).status).toBe(403);
    setEnv("VERCEL", undefined);
    setEnv("CI", "1");
    expect((await GET(request("http://localhost:3000/api/voyage/local-credentials"))).status).toBe(403);
  });

  it("rejects GET from a non-localhost host", async () => {
    const response = await GET(request("http://example.com/api/voyage/local-credentials"));
    expect(response.status).toBe(403);
  });

  it("allows GET from localhost and 127.0.0.1 and returns presence", async () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      const response = await GET(request(`http://${host}:3000/api/voyage/local-credentials`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ configured: { LLM_API_KEY: true } });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("rejects POST with a cross-site origin even from localhost", async () => {
    const response = await POST(request("http://localhost:3000/api/voyage/local-credentials", {
      method: "POST",
      origin: "http://evil.example",
      body: { key: "LLM_API_KEY", value: "sk-test" },
    }));
    expect(response.status).toBe(403);
    expect(saveLocalCredential).not.toHaveBeenCalled();
  });

  it("accepts a POST of a single same-origin credential", async () => {
    const response = await POST(request("http://localhost:3000/api/voyage/local-credentials", {
      method: "POST",
      origin: "http://localhost:3000",
      body: { key: "LLM_API_KEY", value: "sk-test" },
    }));
    expect(response.status).toBe(200);
    expect(saveLocalCredential).toHaveBeenCalledWith("LLM_API_KEY", "sk-test");
  });

  it("accepts a POST batch of same-origin credentials", async () => {
    const response = await POST(request("http://localhost:3000/api/voyage/local-credentials", {
      method: "POST",
      origin: "http://localhost:3000",
      body: { values: { LLM_API_KEY: "sk-test", LLM_MODEL: "qwen-plus" } },
    }));
    expect(response.status).toBe(200);
    expect(saveLocalCredentials).toHaveBeenCalledWith({ LLM_API_KEY: "sk-test", LLM_MODEL: "qwen-plus" });
  });

  it("rejects a POST with a non-string value", async () => {
    const response = await POST(request("http://localhost:3000/api/voyage/local-credentials", {
      method: "POST",
      origin: "http://localhost:3000",
      body: { key: "LLM_API_KEY", value: 42 },
    }));
    expect(response.status).toBe(400);
    expect(saveLocalCredential).not.toHaveBeenCalled();
  });

  it("maps service rejection to 400 without echoing values", async () => {
    vi.mocked(saveLocalCredential).mockRejectedValueOnce(new Error("Unknown configuration field"));
    const response = await POST(request("http://localhost:3000/api/voyage/local-credentials", {
      method: "POST",
      origin: "http://localhost:3000",
      body: { key: "NOT_AN_EDITABLE_KEY", value: "x" },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid field or value" });
  });

  it("requires a key on DELETE and enforces same-origin", async () => {
    const crossOrigin = await DELETE(request("http://localhost:3000/api/voyage/local-credentials?key=LLM_API_KEY", {
      method: "DELETE",
      origin: "http://evil.example",
    }));
    expect(crossOrigin.status).toBe(403);

    const noKey = await DELETE(request("http://localhost:3000/api/voyage/local-credentials", {
      method: "DELETE",
      origin: "http://localhost:3000",
    }));
    expect(noKey.status).toBe(400);

    const ok = await DELETE(request("http://localhost:3000/api/voyage/local-credentials?key=LLM_API_KEY", {
      method: "DELETE",
      origin: "http://localhost:3000",
    }));
    expect(ok.status).toBe(200);
    expect(removeLocalCredential).toHaveBeenCalledWith("LLM_API_KEY");
  });
});
