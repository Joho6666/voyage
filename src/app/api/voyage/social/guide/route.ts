import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createTikHubProvider } from "@/services/social/tikhub";
import { SocialProviderRouter } from "@/services/social/router";
import { collectGuidePosts } from "@/services/planning/guide-extract";
import { failureMessage } from "@/lib/failure-message";
import { enforceRateLimit } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  city: z.string().trim().min(1).max(80),
  query: z.string().trim().max(120).optional(),
  category: z.enum(["route", "food", "latest", "custom"]).optional(),
}).strict();

export async function POST(request: NextRequest) {
  // Paid providers behind this route share one budget per caller.
  const limited = enforceRateLimit(request, "social");
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "缺少城市参数" } }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const router = new SocialProviderRouter([createTikHubProvider()]);
  try {
    const result = await collectGuidePosts(
      router,
      parsed.data.city,
      parsed.data.query,
      10,
      parsed.data.category,
    );
    // ok stays true with an empty list when the platform is down or unconfigured:
    // the panel renders the honest status instead of an error wall.
    return NextResponse.json({
      ok: true,
      data: { posts: result.posts, platformStatus: result.platformStatus },
      warnings: result.warnings,
      generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: { code: "GUIDE_FETCH_FAILED", message: failureMessage(error, "小红书攻略获取失败，请稍后重试") },
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
