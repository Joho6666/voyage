// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/agent/plan-actions/route";

function request(body: unknown) {
  return new NextRequest("http://local/api/agent/plan-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("legacy agent plan-actions boundary", () => {
  it("rejects the legacy persistence opt-in", async () => {
    const response = await POST(request({
      trip: { id: "client-supplied-trip" },
      message: "把第一天安排得轻松一些",
      persist: true,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "CONFIRMATION_REQUIRED",
      detail: "This endpoint only previews a change. Use propose-change, then apply-change with confirmed=true.",
    });
  });
});
