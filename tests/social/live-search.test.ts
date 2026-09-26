import { describe, expect, it, vi } from "vitest";
import { searchTravelSocial } from "@/services/social/live-search";
import type { SocialObservation, SocialPlatform } from "@/services/social/types";

function observation(platform: SocialPlatform, id: string, content: string): SocialObservation {
  const now = new Date();
  return {
    provider: "tikhub", platform, sourceId: id, city: "测试城", content,
    fetchedAt: now.toISOString(), publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    metrics: { likes: 200 }, rawMetadata: {},
  };
}

describe("live travel social search", () => {
  it("merges four platforms, removes reposts and keeps a single provider failure isolated", async () => {
    const searchContent = vi.fn(async ({ platform }: { platform?: SocialPlatform }) => {
      if (platform === "douyin") return { status: "error" as const, data: [], warnings: ["upstream unavailable"] };
      if (platform === "xiaohongshu") return { status: "ok" as const, data: [observation(platform, "note-1", "测试城 景点排队很多")], warnings: [] };
      if (platform === "weibo") return { status: "ok" as const, data: [observation(platform, "post-1", "测试城 景点排队很多")], warnings: [] };
      return { status: "ok" as const, data: [observation("wechat_search", "article-1", "测试城 景点关闭施工")], warnings: [] };
    });
    const result = await searchTravelSocial({ city: "测试城", query: "景点" }, { searchContent });
    expect(searchContent).toHaveBeenCalledTimes(4);
    expect(result.platformStatus).toMatchObject({ douyin: "error", xiaohongshu: "ok", weibo: "ok", wechat_search: "ok" });
    expect(result.observations).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.signals.some((signal) => signal.signalType === "crowd_risk")).toBe(true);
    expect(result.warnings).toContain("douyin: upstream unavailable");
  });

  it("returns empty evidence when every platform is unavailable", async () => {
    const result = await searchTravelSocial({ city: "另一城" }, {
      searchContent: async () => ({ status: "unavailable", data: [], warnings: ["no key"] }),
    });
    expect(result.observations).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.evidence).toEqual([]);
  });
});
