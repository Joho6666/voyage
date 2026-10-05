import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatJson, chatWithTools } from "@/services/ai/llm";

const originalEnv: Record<string, string | undefined> = {};
const fetchMock = vi.fn();

function setEnv(name: string, value: string | undefined) {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function completionContent(content: unknown) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

describe.sequential("llm transport robustness", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setEnv("VOYAGE_SKIP_LOCAL_CREDENTIALS", "1");
    setEnv("LLM_BASE_URL", "http://llm.test/v1");
    setEnv("LLM_API_KEY", "test-key");
    setEnv("LLM_MODEL", "test-model");
    setEnv("LLM_RETRY_BASE_MS", "0");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [name, value] of Object.entries(originalEnv)) setEnv(name, value);
  });

  it("retries a 500 and succeeds on a later attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(completionContent('{"ok":true}'));
    await expect(chatJson({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient client errors", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(chatJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("LLM request failed (400)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network-level failures", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(completionContent('{"ok":1}'));
    await expect(chatJson({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects the Retry-After header on 429", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(completionContent('{"ok":1}'));
    await expect(chatJson({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries and reports the last status", async () => {
    fetchMock.mockResolvedValue(new Response("still down", { status: 503 }));
    await expect(chatJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("(503)");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("returns malformed tool arguments instead of dropping them", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [
            { id: "call-ok", type: "function", function: { name: "get_trip", arguments: '{"tripId":"t-1"}' } },
            { id: "call-bad-json", type: "function", function: { name: "get_weather", arguments: '{"city": 重庆' } },
            { id: "call-not-object", type: "function", function: { name: "plan_route", arguments: '"just a string"' } },
          ],
        },
      }],
    }));
    const result = await chatWithTools({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(result.toolCalls).toEqual([{ id: "call-ok", name: "get_trip", arguments: { tripId: "t-1" } }]);
    expect(result.malformedToolCalls).toEqual([
      { id: "call-bad-json", name: "get_weather", error: "arguments are not valid JSON" },
      { id: "call-not-object", name: "plan_route", error: "arguments must be a JSON object" },
    ]);
  });

  it("strips markdown fences from JSON content", async () => {
    fetchMock.mockResolvedValueOnce(completionContent('```json\n{"names":["洪崖洞"]}\n```'));
    await expect(chatJson({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({ names: ["洪崖洞"] });
  });
});
