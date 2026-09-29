import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { providerFromEnvironment } from "@/skill/providers";
import { extractGuidePlaceNames, resolveGuideCandidates } from "@/services/planning/guide-extract";
import { failureMessage } from "@/lib/failure-message";
import { normalizeProviderError } from "@/skill/errors";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  city: z.string().trim().min(1).max(80),
  text: z.string().trim().min(10).max(4000),
}).strict();

export async function POST(request: NextRequest) {
  // Paid providers behind this route share one budget per caller.
  const limited = enforceRateLimit(request, "social");
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "需要城市和攻略原文（10–4000 字）" } }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const provider = await providerFromEnvironment();
    const extraction = await extractGuidePlaceNames(parsed.data.text);
    const candidates = await resolveGuideCandidates(provider, parsed.data.city, extraction.names);
    return NextResponse.json({
      ok: true,
      data: {
        extractionSource: extraction.source,
        candidates,
        resolvedCount: candidates.filter((candidate) => candidate.resolved).length,
      },
      warnings: [
        ...(extraction.fallbackReason ? [extraction.fallbackReason] : []),
        "地点由高德解析；解析失败的名称不会被编造或替换。",
      ],
      generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const providerError = normalizeProviderError(error, "NO_PROVIDER_CONFIGURED");
    const status = providerError.code === "NO_PROVIDER_CONFIGURED" ? 503 : 502;
    logger.warn("extract-places.failed", { code: providerError.code, error });
    return NextResponse.json({
      ok: false,
      error: { code: providerError.code, message: failureMessage(error, "地点解析失败，请稍后重试") },
    }, { status, headers: { "cache-control": "no-store" } });
  }
}
