// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalSourceUrl, resolveSourceLink } from "@/services/social/source-link";

describe("social source links", () => {
  it("derives a canonical link from a platform item id", () => {
    expect(canonicalSourceUrl("xiaohongshu", "6512ab34cd56ef78")).toBe("https://www.xiaohongshu.com/explore/6512ab34cd56ef78");
    expect(canonicalSourceUrl("weibo", "4987654321098765")).toBe("https://m.weibo.cn/detail/4987654321098765");
    expect(canonicalSourceUrl("douyin", "7301234567890123456")).toBe("https://www.douyin.com/video/7301234567890123456");
  });

  it("does not invent a link for platforms without an id-based public URL", () => {
    // wechat_search has no stable public URL shape for a search result id.
    expect(canonicalSourceUrl("wechat_search", "abcdef123456")).toBeUndefined();
    expect(canonicalSourceUrl("unknown_platform", "abcdef123456")).toBeUndefined();
  });

  it("refuses ids that would not form a safe path segment", () => {
    expect(canonicalSourceUrl("xiaohongshu", "abc")).toBeUndefined();
    expect(canonicalSourceUrl("xiaohongshu", "../../etc/passwd")).toBeUndefined();
    expect(canonicalSourceUrl("xiaohongshu", "id with spaces")).toBeUndefined();
    expect(canonicalSourceUrl("xiaohongshu", undefined)).toBeUndefined();
    expect(canonicalSourceUrl("xiaohongshu", "   ")).toBeUndefined();
  });

  it("prefers the upstream URL and labels it as upstream", () => {
    const link = resolveSourceLink({
      platform: "xiaohongshu",
      sourceId: "6512ab34cd56ef78",
      upstreamUrl: "https://www.xiaohongshu.com/discovery/item/6512ab34cd56ef78?xsec_token=abc",
    });
    expect(link).toEqual({ url: "https://www.xiaohongshu.com/discovery/item/6512ab34cd56ef78?xsec_token=abc", kind: "upstream" });
  });

  it("falls back to a derived link and labels it as derived", () => {
    const link = resolveSourceLink({ platform: "weibo", sourceId: "4987654321098765" });
    expect(link).toEqual({ url: "https://m.weibo.cn/detail/4987654321098765", kind: "derived" });
  });

  it("reports no link when neither upstream nor derivation is available", () => {
    // This is the case that must keep saying "unavailable" rather than guess.
    expect(resolveSourceLink({ platform: "wechat_search", sourceId: "abcdef123456" })).toBeUndefined();
  });

  it("ignores a non-https upstream value instead of passing it through", () => {
    const link = resolveSourceLink({
      platform: "weibo",
      sourceId: "4987654321098765",
      upstreamUrl: "sinaweibo://detail/4987654321098765",
    });
    expect(link).toEqual({ url: "https://m.weibo.cn/detail/4987654321098765", kind: "derived" });
  });
});
