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
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

export interface LlmTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolChatResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export async function chatWithTools(options: {
  messages: ChatMessage[];
  tools: LlmTool[];
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ToolChatResult> {
  const config = getLlmConfig();
  if (!config) throw new Error("LLM is not configured: set LLM_BASE_URL / LLM_MODEL");
  const base = assertPublicHttpUrl(config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await fetch(new URL("chat/completions", base), {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, messages: options.messages, tools: options.tools, tool_choice: "auto", temperature: 0.2, max_tokens: options.maxTokens ?? 2500 }),
    });
    if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }> };
    const message = data.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).flatMap((call) => {
      if (call.type !== "function" || !call.id || !call.function?.name) return [];
      try {
        const args = JSON.parse(call.function.arguments || "{}") as unknown;
        return args && typeof args === "object" ? [{ id: call.id, name: call.function.name, arguments: args as Record<string, unknown> }] : [];
      } catch { return []; }
    });
    return { content: message?.content?.trim() ?? "", toolCalls };
  } finally { clearTimeout(timeout); }
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
