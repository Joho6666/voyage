import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createTikHubProvider } from "@/services/social/tikhub";
import { SocialProviderRouter } from "@/services/social/router";
import { parseSocialLink } from "@/services/social/short-link";
import { extractGuidePlaceNames, resolveGuideCandidates } from "@/services/planning/guide-extract";
import { providerFromEnvironment } from "@/skill/providers";
import { failureMessage } from "@/lib/failure-message";
import { enforceRateLimit } from "@/lib/api-guards";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  url: z.string().trim().min(8).max(600),
  city: z.string().trim().min(1).max(80),
}).strict();

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
};

/**
 * Paste a 小红书/抖音 link → fetch the post text → extract places → resolve
 * them to real POIs (AMap). The link is resolved and fetched server-side only,
 * against a platform host whitelist; everything below degrades honestly when
 * upstream cannot return the post body (the caller can fall back to pasting
 * the guide text instead).
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "social");
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "需要链接和城市" } }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  let link;
  try {
    link = await parseSocialLink(parsed.data.url);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: { code: "LINK_UNRESOLVED", message: failureMessage(error, "链接解析失败，可改用「粘贴攻略文本」") },
    }, { status: 422, headers: { "cache-control": "no-store" } });
  }
  if (!link) {
    return NextResponse.json({
      ok: false,
      error: { code: "LINK_UNSUPPORTED", message: "暂不支持这个链接（目前支持小红书笔记与抖音视频链接），可改用「粘贴攻略文本」" },
    }, { status: 422, headers: { "cache-control": "no-store" } });
  }

  const platformLabel = PLATFORM_LABEL[link.platform] ?? link.platform;
  try {
    const router = new SocialProviderRouter([createTikHubProvider()]);
    const result = await router.getContent({ platform: link.platform, sourceId: link.sourceId, shareUrl: link.shareUrl });
    if (result.status !== "ok") {
      return NextResponse.json({
        ok: false,
        error: {
          code: "CONTENT_UNAVAILABLE",
          message: `${platformLabel}内容获取失败（${result.warnings[0] ?? "上游不可用"}），可改用「粘贴攻略文本」`,
        },
      }, { status: 502, headers: { "cache-control": "no-store" } });
    }
    const observation = result.data;
    const text = observation?.content?.trim() ?? "";
    if (!text) {
      return NextResponse.json({
        ok: false,
        error: {
          code: "CONTENT_EMPTY",
          message: `这条${platformLabel}内容没有可解析的正文（可能是纯视频/图片无文案），可改用「粘贴攻略文本」`,
        },
      }, { status: 422, headers: { "cache-control": "no-store" } });
    }

    const provider = await providerFromEnvironment();
    const extraction = await extractGuidePlaceNames(text);
    const candidates = await resolveGuideCandidates(provider, parsed.data.city, extraction.names);
    const resolvedCount = candidates.filter((candidate) => candidate.resolved).length;

    return NextResponse.json({
      ok: true,
      data: {
        platform: link.platform,
        platformLabel,
        sourceId: link.sourceId,
        sourceUrl: link.shareUrl,
        title: (observation?.summary ?? text).slice(0, 60),
        extractionSource: extraction.source,
        candidates,
        resolvedCount,
      },
      warnings: [
        ...(extraction.fallbackReason ? [extraction.fallbackReason] : []),
        "地点由高德解析；解析失败的名称不会被编造或替换。",
      ],
      generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logger.warn("extract-link.failed", { platform: link.platform, error });
    return NextResponse.json({
      ok: false,
      error: { code: "EXTRACT_LINK_FAILED", message: failureMessage(error, `从${platformLabel}链接解析地点失败，可改用「粘贴攻略文本」`) },
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
