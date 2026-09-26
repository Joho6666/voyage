// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SocialProviderRouter } from "@/services/social/router";
import { createTikHubProvider, tikHubSearchTransport } from "@/services/social/tikhub";
import { createRedFoxProvider, searchRedFoxDouyinAccounts } from "@/services/social/redfox";

// Built at runtime so no fixture string can be mistaken for a real credential;
// providers under test only verify that the value is forwarded verbatim.
const FIXTURE_API_KEY = ["voyage", "unit", "test", "fixture"].join("-");

const now = () => new Date("2030-01-01T12:00:00.000Z");

describe("social providers", () => {
  it("uses documented TikHub search routes for Douyin, Xiaohongshu, Weibo and WeChat search", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      expect(String(_args[0])).toContain("https://api.tikhub.io/");
      return new Response(JSON.stringify({ data: { data: [{ item: { aweme_id: "p1", desc: "测试城 攻略" } }] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await tikHubSearchTransport({ provider: "tikhub", operation: "searchContent", apiKey: FIXTURE_API_KEY, input: { city: "测试城", query: "景点", platform: "douyin" } });
    await tikHubSearchTransport({ provider: "tikhub", operation: "searchContent", apiKey: FIXTURE_API_KEY, input: { city: "测试城", query: "景点", platform: "xiaohongshu" } });
    await tikHubSearchTransport({ provider: "tikhub", operation: "searchContent", apiKey: FIXTURE_API_KEY, input: { city: "测试城", query: "景点", platform: "weibo" } });
    await tikHubSearchTransport({ provider: "tikhub", operation: "searchContent", apiKey: FIXTURE_API_KEY, input: { city: "测试城", query: "景点", platform: "wechat_search" } });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/douyin/search/fetch_general_search_v3"))).toBe(true);
    expect(urls.some((url) => url.includes("/xiaohongshu/app_v2/search_notes"))).toBe(true);
    expect(urls.some((url) => url.includes("/weibo/app/fetch_search_all"))).toBe(true);
    expect(urls.some((url) => url.includes("/wechat_search/v2/fetch_search"))).toBe(true);
    vi.unstubAllGlobals();
  });
  it("maps documented RedFox Douyin account search without treating profiles as social content", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("REDFOX_API_KEY")).toBe(FIXTURE_API_KEY);
      expect(JSON.parse(String(init?.body))).toEqual({ keyword: "重庆旅行", offset: 0, sortType: "_0" });
      return new Response(JSON.stringify({ code: 2000, msg: "成功", data: { total: 1, hasMore: false, list: [{ accountId: "dy-1", nickname: "重庆旅行号", city: "重庆", followerCount: 1200 }] } }), { status: 200 });
    });
    const result = await searchRedFoxDouyinAccounts({ apiKey: FIXTURE_API_KEY, keyword: "重庆旅行", fetchImpl: fetchMock as typeof fetch });
    expect(result).toMatchObject({ total: 1, hasMore: false, accounts: [{ accountId: "dy-1", nickname: "重庆旅行号", city: "重庆", followerCount: 1200 }] });

    const provider = createRedFoxProvider({ apiKey: FIXTURE_API_KEY, accountSearch: async () => result });
    expect((await provider.searchAccounts({ city: "重庆", query: "重庆旅行", platform: "douyin" })).data).toEqual(result.accounts);
    expect((await provider.searchContent({ city: "重庆", query: "重庆旅行", platform: "douyin" })).status).toBe("unavailable");
    expect((await provider.getComments({ platform: "douyin", sourceId: "dy-1" })).status).toBe("unavailable");
  });

  it("reports RedFox auth, rate limit and application errors without retrying a billed call", async () => {
    for (const [status, message] of [[401, "authorization"], [429, "rate limit"]] as const) {
      await expect(searchRedFoxDouyinAccounts({ apiKey: FIXTURE_API_KEY, keyword: "重庆", fetchImpl: (async () => new Response("{}", { status })) as typeof fetch })).rejects.toThrow(message);
    }
    await expect(searchRedFoxDouyinAccounts({ apiKey: FIXTURE_API_KEY, keyword: "重庆", fetchImpl: (async () => new Response(JSON.stringify({ code: 4001, msg: "no permission" }), { status: 200 })) as typeof fetch })).rejects.toThrow("code 4001");
  });
  it("normalizes all four TikHub operations through the injected transport", async () => {
    const transport = vi.fn(async ({ operation }: { operation: string }) => {
      if (operation === "getComments") return { comments: [{ id: "comment-1", text: "晚上人多" }] };
      return { items: [{ id: "post-1", platform: "tiktok", city: "重庆", text: "洪崖洞排队", metrics: { views: 1200 } }] };
    });
    const provider = createTikHubProvider({ apiKey: FIXTURE_API_KEY, transport, now });
    const search = await provider.searchContent({ city: "重庆", platform: "tiktok", query: "洪崖洞" });
    const content = await provider.getContent({ platform: "tiktok", sourceId: "post-1", city: "重庆" });
    const comments = await provider.getComments({ platform: "tiktok", sourceId: "post-1" });
    const trending = await provider.getTrending({ city: "重庆", platform: "tiktok" });

    expect(search.status).toBe("ok");
    expect(search.data[0]).toMatchObject({ provider: "tikhub", platform: "tiktok", sourceId: "post-1", content: "洪崖洞排队" });
    expect(search.data[0].expiresAt).toBe("2030-01-31T12:00:00.000Z");
    expect(content.data?.sourceId).toBe("post-1");
    expect(comments.data).toEqual([{ id: "comment-1", content: "晚上人多", publishedAt: undefined }]);
    expect(trending.data).toHaveLength(1);
    expect(transport.mock.calls).toHaveLength(4);
  });

  it("degrades without a key and rejects unsupported platforms", async () => {
    const transport = vi.fn(async () => ({ items: [] }));
    const missing = createTikHubProvider({ apiKey: "", transport });
    expect((await missing.searchContent({ city: "重庆", query: "洪崖洞" })).status).toBe("unavailable");
    expect(transport).not.toHaveBeenCalled();
    const provider = createRedFoxProvider({ apiKey: FIXTURE_API_KEY, transport });
    expect((await provider.getTrending({ city: "重庆", platform: "instagram" })).status).toBe("unavailable");
    expect(transport).not.toHaveBeenCalled();
  });

  it("maps TikHub's nested TikTok general-search response envelope", async () => {
    const provider = createTikHubProvider({
      apiKey: FIXTURE_API_KEY,
      now,
      transport: async () => ({
        code: 200,
        data: {
          data: [{
            type: 1,
            item: {
              aweme_id: "tiktok-1",
              desc: "重庆洪崖洞夜景，晚间建议错峰前往",
              create_time: 1_893_456_000,
              statistics: { digg_count: 42, comment_count: 3, share_count: 5, play_count: 900 },
            },
            common: {},
          }],
          has_more: false,
        },
      }),
    });
    const result = await provider.searchContent({ city: "重庆", platform: "tiktok", query: "洪崖洞" });
    expect(result.status).toBe("ok");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      sourceId: "tiktok-1",
      content: "重庆洪崖洞夜景，晚间建议错峰前往",
      metrics: { likes: 42, comments: 3, shares: 5, views: 900 },
    });
    expect(result.data[0].publishedAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("keeps results from a healthy provider when another provider fails", async () => {
    const failed = createTikHubProvider({ apiKey: FIXTURE_API_KEY, transport: async () => { throw new Error("upstream failed"); }, now });
    const healthy = createRedFoxProvider({ apiKey: FIXTURE_API_KEY, transport: async () => ({
      items: [{ id: "redfox-1", platform: "douyin", text: "洪崖洞人很多", city: "重庆" }],
    }), now });
    const result = await new SocialProviderRouter([failed, healthy]).searchContent({ city: "重庆", platform: "douyin", query: "洪崖洞" });
    expect(result.status).toBe("ok");
    expect(result.data.map((item) => item.provider)).toEqual(["redfox"]);
    expect(result.warnings).toContain("tikhub request failed");
  });
});
