import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { readRequestCookie } from "@/lib/cookie";

/**
 * In-memory sliding-window rate limiting for routes that spend paid provider
 * quota (AMap, TikHub, LLM, Fliggy). Single-instance only: a multi-instance
 * deployment needs a shared store (Redis etc.) or the budget is per process.
 */

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

/** Shared budgets per paid backend, not per route, so one caller cannot fan out across endpoints. */
export const RATE_LIMITS = {
  amap: { windowMs: 60_000, max: 60 },
  social: { windowMs: 60_000, max: 15 },
  llm: { windowMs: 60_000, max: 15 },
  fliggy: { windowMs: 60_000, max: 15 },
  planning: { windowMs: 60_000, max: 10 },
  write: { windowMs: 60_000, max: 60 },
  read: { windowMs: 60_000, max: 120 },
} as const satisfies Record<string, RateLimitRule>;

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;
const GUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientKey(request: Request | NextRequest) {
  // The guest cookie identifies a browser — but only if it is a real workspace
  // id. Everything malformed collapses into the shared anonymous bucket.
  // x-forwarded-for is deliberately NOT part of the key: on a self-hosted
  // direct deployment the client fully controls that header, so including it
  // let anyone mint fresh buckets per request and void every limit. A reverse
  // proxy deployment can reintroduce a trusted IP component here.
  const rawGuest = readRequestCookie(request, "voyage_guest_workspace");
  const guest = rawGuest && GUEST_ID_PATTERN.test(rawGuest) ? rawGuest : "no-guest";
  return guest;
}

export function rateLimit(request: Request | NextRequest, scope: string, rule: RateLimitRule): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const key = `${scope}:${clientKey(request)}`;
  const now = Date.now();
  const windowStart = now - rule.windowMs;
  const timestamps = (buckets.get(key) ?? []).filter((ts) => ts > windowStart);
  if (timestamps.length >= rule.max) {
    // With an empty window (max 0) the next slot opens a full window out.
    const oldestHit = timestamps[0] ?? now;
    const retryAfterMs = oldestHit + rule.windowMs - now;
    buckets.set(key, timestamps);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  timestamps.push(now);
  buckets.set(key, timestamps);
  // Hard memory cap: evict in insertion order. A bucket that is still active
  // gets rebuilt on its next request, so eviction cannot lose a limit that
  // has been hit — the overflowing keys are the hostile ones.
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
  return { ok: true };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "请求太频繁了。为了控制高德、社交检索等付费接口的成本，服务端做了限流，请稍后再试。",
      },
    },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds), "cache-control": "no-store" } },
  );
}

/** One-line guard for route handlers: returns a 429 response when over budget. */
export function enforceRateLimit(request: Request | NextRequest, scope: keyof typeof RATE_LIMITS | string, rule?: RateLimitRule): NextResponse | null {
  const applied = rule ?? RATE_LIMITS[scope as keyof typeof RATE_LIMITS];
  const result = rateLimit(request, scope, applied);
  return result.ok ? null : rateLimitResponse(result.retryAfterSeconds);
}
