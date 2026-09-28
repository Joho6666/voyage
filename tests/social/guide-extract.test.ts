// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({
  getLlmConfig: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock("@/services/ai/llm", () => llm);

import { POST as guideRoute } from "@/app/api/voyage/social/guide/route";
import { POST as extractRoute } from "@/app/api/voyage/social/extract-places/route";
import {
  collectGuidePosts,
  extractCandidatesWithRules,
  extractGuidePlaceNames,
  resolveGuideCandidates,
  type GuidePlaceProvider,
} from "@/services/planning/guide-extract";
import { SocialProviderRouter } from "@/services/social/router";
import type { SocialObservation, SocialProvider } from "@/services/social/types";
import type { Place } from "@/types/travel";

function observation(partial: Partial<SocialObservation> & { sourceId: string; content: string }): SocialObservation {
  const now = new Date();
  return {
    provider: "tikhub",
    platform: "xiaohongshu",
    city: "南京",
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    metrics: {},
    rawMetadata: {},
    ...partial,
  };
}

class FakeXhsProvider implements SocialProvider {
  readonly name = "tikhub" as const;
  readonly platforms = ["xiaohongshu"] as const;
  readonly configured = true;
  constructor(private readonly observations: SocialObservation[]) {}
  async searchContent() { return { status: "ok" as const, data: this.observations, warnings: [] }; }
  async getTrending() { return { status: "ok" as const, data: this.observations, warnings: [] }; }
  async getContent() { return { status: "ok" as const, data: this.observations[0] ?? null, warnings: [] }; }
  async getComments() { return { status: "ok" as const, data: [], warnings: [] }; }
}

function provider(places: Place[], failingNames: string[] = []): GuidePlaceProvider {
  return {
    async searchPlaces(input) {
      if (failingNames.includes(input.query)) throw new Error("AMap search failed");
      const needle = input.query.toLowerCase();
      return places.filter((place) => !needle || [place.name, ...place.tags].join(" ").toLowerCase().includes(needle) || needle.includes(place.name.toLowerCase()) || place.name.includes(input.query)).slice(0, input.limit);
    },
  };
}

function place(name: string, id = `amap-${name}`): Place {
  return {
    id, name, category: "attraction", lat: 32.02, lng: 118.79, rating: 4.5, reviewCount: 0, image: "",
    priceLevel: 0, address: "南京", openingStatus: "unknown", stayMinutes: 90, description: "", tags: [],
    district: "玄武区", source: "amap", sourceId: id, provenance: { source: "amap", estimated: false },
  };
}

describe("guide place-name extraction (rules)", () => {
  it("extracts route fragments in order, dropping stopwords and noise", () => {
    const text = "南京三日游路线：Day1 先锋书店→颐和路——宁海中学北门→金银街、陶谷新村；第二天早上先去南京博物院，住宿推荐新街口。";
    const names = extractCandidatesWithRules(text);
    expect(names).toContain("先锋书店");
    expect(names).toContain("颐和路");
    expect(names).toContain("金银街");
    expect(names).toContain("南京博物院");
    expect(names).not.toContain("攻略");
    expect(names).not.toContain("住宿");
    expect(names.length).toBeLessThanOrEqual(8);
    // Order follows the text, so the traveller reads the route as written.
    expect(names.indexOf("先锋书店")).toBeLessThan(names.indexOf("金银街"));
  });

  it("extracts food and restaurant spots without dropping them as stopwords", () => {
    const text = "重庆火锅必吃榜：老巷子火锅、九街淑芬串串、赵记牛肉面馆、山城老茶楼、顺风大排档。";
    const names = extractCandidatesWithRules(text);
    expect(names).toContain("老巷子火锅");
    expect(names).toContain("九街淑芬串串");
    expect(names).toContain("赵记牛肉面馆");
    expect(names).toContain("山城老茶楼");
    expect(names).toContain("顺风大排档");
  });

  it("dedupes and caps at 8 candidates", () => {
    const text = Array.from({ length: 14 }, (_, index) => `景点${index}路`).join("→");
    const names = extractCandidatesWithRules(text);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(8);
  });
});

describe("guide place-name extraction (LLM with fallback)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VOYAGE_LLM_ENABLED", "1");
    llm.getLlmConfig.mockReset();
    llm.chatJson.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a schema-valid LLM answer and filters implausible names", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test" });
    llm.chatJson.mockResolvedValue({ names: ["先锋书店", "Day1", "xx", "颐和路", "颐和路"] });
    const result = await extractGuidePlaceNames("先锋书店 颐和路");
    expect(result.source).toBe("llm");
    expect(result.names).toEqual(["先锋书店", "颐和路"]);
  });

  it("falls back to rules when the LLM answer fails validation", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test" });
    llm.chatJson.mockResolvedValue({ names: "not an array" });
    const result = await extractGuidePlaceNames("先锋书店→颐和路");
    expect(result.source).toBe("rules");
    expect(result.fallbackReason).toContain("schema");
    expect(result.names).toContain("先锋书店");
  });

  it("falls back to rules when no LLM is configured", async () => {
    llm.getLlmConfig.mockReturnValue(null);
    const result = await extractGuidePlaceNames("先锋书店→颐和路");
    expect(result.source).toBe("rules");
    expect(llm.chatJson).not.toHaveBeenCalled();
  });
});

describe("guide candidate resolution", () => {
  const catalog = [place("先锋书店五台山店"), place("颐和路民国公馆区"), place("南京博物院")];

  it("resolves names to provider places with a stated match basis", async () => {
    const candidates = await resolveGuideCandidates(provider(catalog), "南京", ["先锋书店五台山店", "南京博物院"]);
    expect(candidates[0]).toMatchObject({ name: "先锋书店五台山店", resolved: true, matchBasis: "exact" });
    expect(candidates[0].place?.provenance?.source).toBe("amap");
    expect(candidates[1]).toMatchObject({ name: "南京博物院", resolved: true });
  });

  it("keeps unresolved names as failures instead of manufacturing matches", async () => {
    // Regression: the removed "first result" fallback once paired the junk
    // phrase 全程适配懒人 with an unrelated nail salon.
    const candidates = await resolveGuideCandidates(provider(catalog), "南京", ["不存在的神秘景点", "全程适配懒人"]);
    expect(candidates[0]).toMatchObject({ resolved: false });
    expect(candidates[0].place).toBeUndefined();
    expect(candidates[0].reason).toContain("未找到");
    expect(candidates[1]).toMatchObject({ name: "全程适配懒人", resolved: false });
    expect(candidates[1].place).toBeUndefined();
  });

  it("reports provider failures per candidate", async () => {
    const candidates = await resolveGuideCandidates(provider(catalog, ["南京博物院"]), "南京", ["南京博物院"]);
    expect(candidates[0].resolved).toBe(false);
    expect(candidates[0].reason).toContain("AMap search failed");
  });
});

describe("guide post collection", () => {
  it("bounds posts, prefers route-style text, and derives the source link", async () => {
    const router = new SocialProviderRouter([new FakeXhsProvider([
      observation({ sourceId: "short-1", content: "太短" }),
      observation({ sourceId: "no-marker", content: `${"南京很好玩。".repeat(30)}` }),
      observation({ sourceId: "route-1", content: `${"南京三日游路线：先锋书店→颐和路→金银街。".repeat(10)}`, metrics: { likes: 1200 } }),
    ])]);
    const result = await collectGuidePosts(router, "南京");
    expect(result.platformStatus.xiaohongshu).toBe("ok");
    expect(result.posts.length).toBeLessThanOrEqual(4);
    expect(result.posts[0].sourceId).toBe("route-1");
    expect(result.posts[0].sourceUrl).toContain("xiaohongshu.com/explore/");
    expect(result.posts[0].sourceUrlKind).toBe("derived");
    expect(result.posts[0].content.length).toBeLessThanOrEqual(2000);
  });

  it("prioritizes food content when category is food", async () => {
    const router = new SocialProviderRouter([new FakeXhsProvider([
      observation({ sourceId: "route-only", content: `${"南京三日游路线推荐：明孝陵—玄武湖—夫子庙。".repeat(5)}` }),
      observation({ sourceId: "food-spot", content: `${"南京必吃美食老字号火锅与鸭血粉丝汤推荐探店。".repeat(5)}`, metrics: { likes: 500 } }),
    ])]);
    const result = await collectGuidePosts(router, "南京", "美食 必吃", 10, "food");
    expect(result.posts[0].sourceId).toBe("food-spot");
  });

  it("orders posts by published date descending when category is latest", async () => {
    const router = new SocialProviderRouter([new FakeXhsProvider([
      observation({ sourceId: "older", content: `${"南京游记分享攻略内容充足。".repeat(8)}`, publishedAt: "2026-08-01T10:00:00Z" }),
      observation({ sourceId: "newest", content: `${"南京最新游记体验刚刚从鸡鸣寺回来。".repeat(8)}`, publishedAt: "2026-09-27T12:00:00Z" }),
      observation({ sourceId: "mid", content: `${"南京旅行路线分享。".repeat(8)}`, publishedAt: "2026-09-10T10:00:00Z" }),
    ])]);
    const result = await collectGuidePosts(router, "南京", "最新 攻略", 10, "latest");
    expect(result.posts.map((p) => p.sourceId)).toEqual(["newest", "mid", "older"]);
  });

  it("reports an unconfigured platform honestly", async () => {
    const router = new SocialProviderRouter([]);
    const result = await collectGuidePosts(router, "南京");
    expect(result.posts).toEqual([]);
    expect(result.platformStatus.xiaohongshu).toBe("unavailable");
  });
});

describe("guide API validation", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "voyage-guide-api-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects a guide request without a city before touching providers", async () => {
    const response = await guideRoute(new NextRequest("http://local/api/voyage/social/guide", { method: "POST", body: JSON.stringify({}) }));
    expect(response.status).toBe(400);
  });

  it("rejects an extraction request with too little text", async () => {
    const response = await extractRoute(new NextRequest("http://local/api/voyage/social/extract-places", { method: "POST", body: JSON.stringify({ city: "南京", text: "太短" }) }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain("10");
  });
});
