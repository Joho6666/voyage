import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { RATE_LIMITS, enforceRateLimit, rateLimit } from "@/lib/api-guards";

function requestWith(guest: string, ip = "203.0.113.9") {
  return new NextRequest("http://local/api/amap/poi", {
    method: "GET",
    headers: { "x-forwarded-for": ip, cookie: `voyage_guest_workspace=${guest}` },
  });
}

describe("paid-route rate limiting", () => {
  it("allows requests under the budget and returns 429 past it", () => {
    const rule = { windowMs: 60_000, max: 3 };
    const scope = `test-amap-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(requestWith("guest-a"), scope, rule).ok).toBe(true);
    }
    const blocked = rateLimit(requestWith("guest-a"), scope, rule);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("recovers after the window passes", async () => {
    const rule = { windowMs: 40, max: 1 };
    const scope = `test-recover-${Date.now()}`;
    expect(rateLimit(requestWith("guest-b"), scope, rule).ok).toBe(true);
    expect(rateLimit(requestWith("guest-b"), scope, rule).ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rateLimit(requestWith("guest-b"), scope, rule).ok).toBe(true);
  });

  it("keeps callers isolated by guest cookie and IP", () => {
    const rule = { windowMs: 60_000, max: 1 };
    const scope = `test-iso-${Date.now()}`;
    expect(rateLimit(requestWith("11111111-1111-4111-8111-111111111111"), scope, rule).ok).toBe(true);
    expect(rateLimit(requestWith("22222222-2222-4222-8222-222222222222"), scope, rule).ok).toBe(true);
    expect(rateLimit(requestWith("11111111-1111-4111-8111-111111111111", "198.51.100.7"), scope, rule).ok).toBe(true);
    expect(rateLimit(requestWith("11111111-1111-4111-8111-111111111111"), scope, rule).ok).toBe(false);
  });

  it("collapses malformed guest cookies into the anonymous bucket", () => {
    // Arbitrary cookie values must not become unbounded bucket keys: they all
    // share the "no-guest" bucket per IP, alongside cookie-less callers.
    const rule = { windowMs: 60_000, max: 1 };
    const scope = `test-malformed-${Date.now()}`;
    expect(rateLimit(requestWith("not-a-uuid"), scope, rule).ok).toBe(true);
    expect(rateLimit(requestWith(""), scope, rule).ok).toBe(false);
    expect(rateLimit(requestWith("../../etc/passwd"), scope, rule).ok).toBe(false);
    // A well-formed guest is still tracked separately.
    expect(rateLimit(requestWith("33333333-3333-4333-8333-333333333333"), scope, rule).ok).toBe(true);
  });

  it("enforceRateLimit returns a 429 envelope with a retry-after header", () => {
    const rule = { windowMs: 60_000, max: 0 };
    const blocked = enforceRateLimit(requestWith("guest-e"), `test-envelope-${Date.now()}`, rule);
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = {
      ok: false,
      error: { code: "RATE_LIMITED", message: expect.stringContaining("限流") },
    } as const;
    void blocked?.json().then((data) => expect(data).toMatchObject(body));
  });

  it("ships a preset budget for every paid backend", () => {
    expect(RATE_LIMITS.amap.max).toBeGreaterThan(RATE_LIMITS.planning.max);
    expect(RATE_LIMITS.social.windowMs).toBe(60_000);
  });
});
