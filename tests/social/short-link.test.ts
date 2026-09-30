// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { parseSocialLink } from "@/services/social/short-link";

function redirectingFetch(location: string, status = 302) {
  return vi.fn(async () => new Response(null, { status, headers: { location } }));
}

describe("parseSocialLink", () => {
  it("parses a xiaohongshu note link with its xsec_token", async () => {
    const link = await parseSocialLink("看看这个 https://www.xiaohongshu.com/explore/6a9133e0000000002a03e7e2?xsec_token=ABC123&xsec_source=pc_search 攻略");
    expect(link).toMatchObject({ platform: "xiaohongshu", sourceId: "6a9133e0000000002a03e7e2", xsecToken: "ABC123" });
    expect(link?.shareUrl).toContain("/explore/6a9133e0000000002a03e7e2");
    expect(link?.shareUrl).toContain("xsec_token=ABC123");
  });

  it("parses a xiaohongshu link without a token", async () => {
    const link = await parseSocialLink("https://www.xiaohongshu.com/explore/abc123def");
    expect(link).toMatchObject({ platform: "xiaohongshu", sourceId: "abc123def" });
    expect(link?.xsecToken).toBeUndefined();
  });

  it("parses douyin video and iesdouyin share links", async () => {
    expect(await parseSocialLink("https://www.douyin.com/video/7530000000000000000")).toMatchObject({ platform: "douyin", sourceId: "7530000000000000000" });
    expect(await parseSocialLink("https://www.iesdouyin.com/share/video/7530000000000000000/")).toMatchObject({ platform: "douyin", sourceId: "7530000000000000000" });
  });

  it("follows an xhslink short link to the note id", async () => {
    const fetchMock = redirectingFetch("https://www.xiaohongshu.com/explore/short123?xsec_token=T9");
    const link = await parseSocialLink("https://xhslink.com/a/xyz", fetchMock as typeof fetch);
    expect(link).toMatchObject({ platform: "xiaohongshu", sourceId: "short123", xsecToken: "T9" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a v.douyin.com short link to the video id", async () => {
    const fetchMock = redirectingFetch("https://www.douyin.com/video/7511111111111111111");
    const link = await parseSocialLink("https://v.douyin.com/iAbCdEf/", fetchMock as typeof fetch);
    expect(link).toMatchObject({ platform: "douyin", sourceId: "7511111111111111111" });
  });

  it("returns null for unsupported or non-link text", async () => {
    expect(await parseSocialLink("https://example.com/explore/abc123")).toBeNull();
    expect(await parseSocialLink("帮我排一个重庆三天的行程")).toBeNull();
    expect(await parseSocialLink("http://127.0.0.1/explore/abc")).toBeNull();
  });

  it("fails readably when a short link serves a page instead of redirecting", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>验证页</html>", { status: 200 }));
    await expect(parseSocialLink("https://xhslink.com/a/blocked", fetchMock as typeof fetch))
      .rejects.toThrow(/短链没有跳转/);
  });

  it("never follows a redirect to a non-platform host", async () => {
    const fetchMock = redirectingFetch("https://evil.example.com/explore/abc");
    await expect(parseSocialLink("https://xhslink.com/a/evil", fetchMock as typeof fetch))
      .rejects.toThrow(/不支持的站点/);
  });
});
