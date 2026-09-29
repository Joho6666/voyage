/**
 * Structured JSON-lines logging for the server. Route handlers and services
 * log through this instead of swallowing failures silently; stdout is the
 * only sink (Next.js collects it), and credentials never pass through here —
 * callers must pass messages/codes, never raw provider envelopes.
 *
 * Deliberately free of "server-only": the standalone CLI (skills/voyage and
 * its tsx runtime) shares this dependency chain, where that module cannot be
 * resolved. Logging is inert either way — plain console output.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_METHOD: Record<Level, "log" | "warn" | "error"> = {
  debug: "log",
  info: "log",
  warn: "warn",
  error: "error",
};

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry, (_key, value) => serialize(value));
  console[LEVEL_METHOD[level]](line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
