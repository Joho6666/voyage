// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SocialProviderRouter } from "@/services/social/router";
import { createTikHubProvider } from "@/services/social/tikhub";
import { createRedFoxProvider } from "@/services/social/redfox";

const now = () => new Date("2030-01-01T12:00:00.000Z");

describe("social providers", () => {
  it("normalizes all four TikHub operations through the injected transport", async () => {
    const transport = vi.fn(async ({ operation }: { operation: string }) => {
      if (operation === "getComments") return { comments: [{ id: "comment-1", text: "晚上人多" }] };
      return { items: [{ id: "post-1", platform: "tiktok", city: "重庆", text: "洪崖洞排队", metrics: { views: 1200 } }] };
    });
    const provider = createTikHubProvider({ apiKey: "test-key", transport, now });
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
    const provider = createRedFoxProvider({ apiKey: "test-key", transport });
    expect((await provider.getTrending({ city: "重庆", platform: "instagram" })).status).toBe("unavailable");
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps results from a healthy provider when another provider fails", async () => {
    const failed = createTikHubProvider({ apiKey: "test-key", transport: async () => { throw new Error("upstream failed"); }, now });
    const healthy = createRedFoxProvider({ apiKey: "test-key", transport: async () => ({
      items: [{ id: "redfox-1", platform: "douyin", text: "洪崖洞人很多", city: "重庆" }],
    }), now });
    const result = await new SocialProviderRouter([failed, healthy]).searchContent({ city: "重庆", platform: "douyin", query: "洪崖洞" });
    expect(result.status).toBe("ok");
    expect(result.data.map((item) => item.provider)).toEqual(["redfox"]);
    expect(result.warnings).toContain("tikhub request failed");
  });
});
