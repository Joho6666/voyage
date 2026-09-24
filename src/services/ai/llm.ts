import "server-only";
import { assertPublicHttpUrl } from "@/lib/safe-url";
import { runtimeConfigSync } from "@/services/config/local-credentials";

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export function getLlmConfig(): LlmConfig | null {
  const baseUrl = runtimeConfigSync("LLM_BASE_URL");
  if (!baseUrl) return null;
  const model = runtimeConfigSync("LLM_MODEL") || "gpt-4o-mini";
  return { baseUrl, apiKey: runtimeConfigSync("LLM_API_KEY"), model };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function stripFences(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
  }
  return trimmed;
}

export async function chatJson(options: {
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  const config = getLlmConfig();
  if (!config) throw new Error("LLM is not configured: set LLM_BASE_URL / LLM_MODEL");
  const base = assertPublicHttpUrl(config.baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await fetch(new URL("chat/completions", base), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: options.messages,
        temperature: 0.4,
        max_tokens: options.maxTokens ?? 4096,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    try {
      return JSON.parse(stripFences(content));
    } catch {
      throw new Error("LLM content is not valid JSON");
    }
  } finally {
    clearTimeout(timeout);
  }
}
