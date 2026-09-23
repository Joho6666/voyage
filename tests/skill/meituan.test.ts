// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapJsonOffers, mapMarkdownOffers, queryMeituan } from "@/services/meituan/runner";

const input = { origin: "重庆", destination: "贵阳", startDate: "2030-05-01", query: "高铁酒店美食", city: "贵阳", categories: ["train", "hotel", "restaurant"] as const };

describe("Meituan travel adapter", () => {
  it("maps structured JSON offers without inventing facts", () => {
    const offers = mapJsonOffers({ offers: [
      { id: "train-1", kind: "train", name: "G2883 重庆西-贵阳北", price: "¥250", url: "https://example.com/train" },
      { id: "hotel-1", kind: "hotel", name: "贵阳示例酒店", rating: "4.8", price: "¥300/晚", url: "https://example.com/hotel" },
    ] }, input, "2030-04-01T00:00:00.000Z");
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ provider: "meituan", structured: true, sourceId: "train-1", bookingUrl: "https://example.com/train" });
    expect(offers[1].priceLabel).toBe("¥300/晚");
  });

  it("retains markdown as unstructured source text", () => {
    const raw = "- 高铁 G2883 重庆西→贵阳北 ¥250\n- 贵阳酒店 ¥300/晚 https://example.com/hotel";
    const offers = mapMarkdownOffers(raw, input, "2030-04-01T00:00:00.000Z");
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]).toMatchObject({ structured: false, rawText: raw, provider: "meituan" });
  });

  it("maps an executable JSON response and never emits the token", async () => {
    const previous = process.env.MEITUAN_HT_TOKEN;
    process.env.MEITUAN_HT_TOKEN = "test-token-not-output";
    try {
      const result = await queryMeituan(input, async () => ({ code: 0, stdout: JSON.stringify({ offers: [{ name: "贵阳酒店", kind: "hotel", url: "https://example.com" }] }), stderr: "" }));
      expect(result.status.overall).toBe("REAL");
      expect(JSON.stringify(result)).not.toContain("test-token-not-output");
    } finally {
      if (previous === undefined) delete process.env.MEITUAN_HT_TOKEN;
      else process.env.MEITUAN_HT_TOKEN = previous;
    }
  });

  it("parses the official JSON envelope whose data field contains markdown", async () => {
    const previous = process.env.MEITUAN_HT_TOKEN;
    process.env.MEITUAN_HT_TOKEN = "test-token-not-output";
    try {
      const stdout = JSON.stringify({ status: "success", data: "[贵阳酒店](https://example.com/hotel) **¥300起**\n高铁 G3714 桂林西→贵阳东 ¥165" });
      const result = await queryMeituan(input, async () => ({ code: 0, stdout, stderr: "" }));
      expect(result.status.overall).toBe("UNSTRUCTURED");
      expect(result.offers.map((offer) => offer.kind)).toEqual(expect.arrayContaining(["hotel", "train"]));
      expect(result.rawJson).toMatchObject({ status: "success" });
    } finally {
      if (previous === undefined) delete process.env.MEITUAN_HT_TOKEN;
      else process.env.MEITUAN_HT_TOKEN = previous;
    }
  });

  it("returns an explicit configuration error without a token", async () => {
    const previous = process.env.MEITUAN_HT_TOKEN;
    delete process.env.MEITUAN_HT_TOKEN;
    try { await expect(queryMeituan(input, async () => ({ code: 0, stdout: "{}", stderr: "" }))).rejects.toMatchObject({ code: "MEITUAN_PROVIDER_NOT_CONFIGURED" }); }
    finally { if (previous !== undefined) process.env.MEITUAN_HT_TOKEN = previous; }
  });
});
