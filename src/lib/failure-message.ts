import { ZodError } from "zod";

/**
 * Every API route must answer failures with something a user can act on.
 *
 * A ZodError's `message` is a JSON dump of issues — `planningFailureMessage`
 * originally existed because `Too big: expected number to be <=31` was being
 * rendered verbatim in the planning chat, and the same dump was later found
 * being fed into the LLM tool context, where the model would echo it back.
 * This shared helper is the single place that sanitizes failure text.
 *
 * SkillError messages are intentionally constructed user-facing strings and are
 * passed through by callers before reaching this helper.
 */
export function failureMessage(error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join(".") ?? "";
    return field
      ? `提交的信息里「${field}」不合法，请检查后重试。`
      : "提交的信息不合法，请检查后重试。";
  }
  const message = error instanceof Error ? error.message : fallback;
  if (!message || /^\s*[\[{]/.test(message)) return fallback;
  return message.replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]").slice(0, 200);
}

/** Bounded text safe to hand to an LLM as tool context — never a raw issue dump. */
export function toolContextMessage(error: unknown) {
  return failureMessage(error, "工具调用失败").slice(0, 200);
}
