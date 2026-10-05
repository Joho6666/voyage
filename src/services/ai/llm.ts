import { assertPublicHttpUrl } from "@/lib/safe-url";
import { logger } from "@/lib/logger";
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

export interface MalformedToolCall {
  id: string;
  name: string;
  error: string;
}

export interface ToolChatResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** Tool calls whose arguments were not valid JSON — the loop must feed
   * these back to the model as tool messages so it can correct itself. */
  malformedToolCalls?: MalformedToolCall[];
}

/** Transient upstream failures worth one more attempt. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

class LlmHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  const value = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const base = envNumber("LLM_RETRY_BASE_MS", 400);
  const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const headerMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
  return Math.max(headerMs, base * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function postChatCompletions(config: LlmConfig, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const base = assertPublicHttpUrl(config.baseUrl);
  const retries = Math.min(5, envNumber("LLM_RETRIES", 2));
  const url = new URL("chat/completions", base);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify(body),
      });
      if (response.ok) return await response.json();
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      const error = new LlmHttpError(`LLM request failed (${response.status}): ${detail}`.trimEnd(), response.status);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === retries) throw error;
      logger.warn("llm.request_retry", { status: response.status, attempt: attempt + 1 });
      await sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
    } catch (error) {
      if (error instanceof LlmHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      }
      // fetch itself rejected (network failure) — transient, worth a retry.
      if (attempt === retries) throw error;
      logger.warn("llm.request_retry", { attempt: attempt + 1, network: true });
      await sleep(retryDelayMs(null, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("LLM request failed: retries exhausted");
}

export async function chatWithTools(options: {
  messages: ChatMessage[];
  tools: LlmTool[];
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ToolChatResult> {
  const config = getLlmConfig();
  if (!config) throw new Error("LLM is not configured: set LLM_BASE_URL / LLM_MODEL");
  const data = await postChatCompletions(config, {
    model: config.model,
    messages: options.messages,
    tools: options.tools,
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: options.maxTokens ?? 2500,
  }, options.timeoutMs ?? envNumber("LLM_TIMEOUT_MS", 60_000)) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }> };

  const message = data.choices?.[0]?.message;
  const toolCalls: ToolChatResult["toolCalls"] = [];
  const malformedToolCalls: MalformedToolCall[] = [];
  for (const call of message?.tool_calls ?? []) {
    if (call.type !== "function" || !call.id || !call.function?.name) {
      logger.debug("llm.tool_call_malformed_protocol", { id: call.id });
      continue;
    }
    try {
      const args = JSON.parse(call.function.arguments || "{}") as unknown;
      if (args && typeof args === "object") {
        toolCalls.push({ id: call.id, name: call.function.name, arguments: args as Record<string, unknown> });
      } else {
        malformedToolCalls.push({ id: call.id, name: call.function.name, error: "arguments must be a JSON object" });
      }
    } catch {
      malformedToolCalls.push({ id: call.id, name: call.function.name, error: "arguments are not valid JSON" });
    }
  }
  return { content: message?.content?.trim() ?? "", toolCalls, malformedToolCalls };
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
  const data = await postChatCompletions(config, {
    model: config.model,
    messages: options.messages,
    temperature: 0.4,
    max_tokens: options.maxTokens ?? 4096,
    response_format: { type: "json_object" },
  }, options.timeoutMs ?? envNumber("LLM_TIMEOUT_MS", 60_000)) as { choices?: Array<{ message?: { content?: string } }> };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  try {
    return JSON.parse(stripFences(content));
  } catch (error) {
    logger.debug("llm.json_content_invalid", { error, prefix: content.slice(0, 80) });
    throw new Error("LLM content is not valid JSON");
  }
}
