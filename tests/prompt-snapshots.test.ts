import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture prompts at the LLM boundary while keeping the real env-driven
// gates (llmEnabled / getLlmConfig) intact.
vi.mock("@/services/ai/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/ai/llm")>();
  return {
    ...actual,
    chatJson: vi.fn(),
    chatWithTools: vi.fn(),
  };
});

import { chatJson, chatWithTools } from "@/services/ai/llm";
import { planConversationTurn } from "@/services/planning/conversation-planner";
import { planOutline } from "@/services/planning/outline-planner";
import { extractGuidePlaceNames } from "@/services/planning/guide-extract";
import { POST as agentPost } from "@/app/api/agent/tools/route";
import { chongqingTrip } from "@/data/demo/chongqing";
import { JsonSkillRepository } from "@/skill/repository";
import type { Place } from "@/types/travel";

const SNAPSHOT_DIR = path.resolve("tests/golden/prompts");
const GUEST_ID = "44444444-4444-4444-8444-444444444444";

/** Snapshots survive reformatting and the wall clock, not semantics. */
function normalizePrompt(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function expectPromptSnapshot(name: string, content: string) {
  const normalized = normalizePrompt(content);
  const file = path.join(SNAPSHOT_DIR, `${name}.txt`);
  if (process.env.UPDATE_PROMPT_SNAPSHOTS === "1") {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(file, `${normalized}\n`);
    return;
  }
  expect(existsSync(file), `${name}.txt is missing — run with UPDATE_PROMPT_SNAPSHOTS=1 to seed it`).toBe(true);
  expect(normalized).toBe(readFileSync(file, "utf8").trimEnd());
}

const originalEnv: Record<string, string | undefined> = {};
let dataDir: string;

function setEnv(name: string, value: string | undefined) {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function seedDemoTrip() {
  const root = path.join(dataDir, "guests", GUEST_ID);
  await new JsonSkillRepository(root).createTrip(structuredClone(chongqingTrip));
}

function agentRequest(tripId: string) {
  return new NextRequest("http://local/api/agent/tools", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      cookie: `voyage_guest_workspace=${GUEST_ID}`,
    }),
    body: JSON.stringify({ tripId, message: "第二天有什么推荐？", history: [] }),
  });
}

describe.sequential("prompt snapshots (5 LLM surfaces)", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "development");
    setEnv("VOYAGE_LLM_ENABLED", "1");
    setEnv("LLM_BASE_URL", "http://llm.test/v1");
    setEnv("LLM_API_KEY", "snapshot-key");
    setEnv("LLM_MODEL", "snapshot-model");
  });

  afterEach(async () => {
    for (const [name, value] of Object.entries(originalEnv)) setEnv(name, value);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("agent tools system prompt", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-prompt-agent-"));
    setEnv("VOYAGE_DATA_DIR", dataDir);
    await seedDemoTrip();
    vi.mocked(chatWithTools).mockResolvedValue({ content: "好的", toolCalls: [] });

    const response = await agentPost(agentRequest(chongqingTrip.id));
    expect(response.status).toBe(200);
    const call = vi.mocked(chatWithTools).mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string | null }> };
    const systemPrompt = call.messages.find((message) => message.role === "system")?.content ?? "";
    expectPromptSnapshot("agent-system-prompt", systemPrompt);
  });

  it("conversational planning dialogue prompt", async () => {
    vi.mocked(chatJson).mockResolvedValue({ profilePatch: {}, assistantMessage: "好的", question: null, ready: false });

    await planConversationTurn({
      profile: { destination: "重庆", travelers: 2 },
      messages: [
        { id: "m1", role: "user", content: "想去重庆玩" },
        { id: "m2", role: "assistant", content: "好嘞，几个人去？" },
      ],
      message: "两个人，预算5000",
    });

    const call = vi.mocked(chatJson).mock.calls[0]?.[0] as { messages: unknown };
    expectPromptSnapshot("planning-dialogue-prompt", JSON.stringify(call.messages, null, 2));
  });

  it("outline generation prompt (system + user)", async () => {
    // Throw after capture: planOutline falls back to rules, which is fine —
    // we only need the LLM-bound messages.
    vi.mocked(chatJson).mockRejectedValue(new Error("capture-only"));

    const places = chongqingTrip.places.slice(0, 6) as Place[];
    await planOutline({
      prompt: "从桂林去重庆玩三天",
      destination: "重庆",
      candidates: places,
      startDate: "2030-05-01",
      endDate: "2030-05-03",
      budget: 2500,
      travelers: 2,
      vibes: ["美食"],
    });

    expect(vi.mocked(chatJson).mock.calls.length).toBeGreaterThan(0);
    const call = vi.mocked(chatJson).mock.calls[0]?.[0] as { messages: unknown };
    expectPromptSnapshot("planning-outline-prompt", JSON.stringify(call.messages, null, 2));
  });

  it("guide place-name extraction prompt", async () => {
    vi.mocked(chatJson).mockResolvedValue({ names: ["洪崖洞"] });

    await extractGuidePlaceNames("昨天去了洪崖洞，人超多，建议晚上六点后去拍夜景");

    const call = vi.mocked(chatJson).mock.calls[0]?.[0] as { messages: unknown };
    expectPromptSnapshot("guide-extract-prompt", JSON.stringify(call.messages, null, 2));
  });
});
