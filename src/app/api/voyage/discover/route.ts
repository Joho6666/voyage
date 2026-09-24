import { NextResponse } from "next/server";
import { amapSearchPois, isAmapConfigured } from "@/services/map/amap-rest";

type DiscoverKind = "hotel" | "food" | "activity";

const SEARCH_TYPES: Record<DiscoverKind, string> = {
  hotel: "100000",
  food: "050000",
  activity: "080000|110000",
};

const cache = new Map<string, { expiresAt: number; data: unknown }>();

function insight(rating?: number, reviewCount?: number, cost?: number) {
  if (!rating && !reviewCount) return "高德未返回完整评价数据，建议打开来源核验。";
  const quality = rating && rating >= 4.5 ? "评分较高" : rating && rating >= 4 ? "评分稳定" : "评分信息有限";
  const volume = reviewCount && reviewCount >= 100 ? "评价量较充足" : "评价量较少或未公开";
  const price = cost ? `人均约 ¥${cost}，可作为预算参考` : "暂未返回人均消费";
  return `${quality}、${volume}；${price}。这是 POI 画像摘要，不是对评论原文的臆测。`;
}

function valueScore(rating?: number, reviewCount?: number, cost?: number) {
  const score = (rating ?? 0) * 16 + Math.min((reviewCount ?? 0) / 100, 10) - Math.min((cost ?? 0) / 100, 10);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { city?: string; kind?: DiscoverKind; query?: string; limit?: number };
    const city = body.city?.trim();
    const kind = body.kind;
    if (!city || !kind || !SEARCH_TYPES[kind]) return NextResponse.json({ ok: false, error: "city and kind are required" }, { status: 400 });
    if (!isAmapConfigured()) return NextResponse.json({ ok: false, status: "UNAVAILABLE", warning: "AMAP_SERVER_KEY 未配置，无法进行实时 POI 发现" }, { status: 503 });

    const query = body.query?.trim() || (kind === "hotel" ? "酒店" : kind === "food" ? "餐厅" : "休闲活动");
    const key = `${city}|${kind}|${query}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.data);
    const pois = await amapSearchPois({ city, keywords: query, types: SEARCH_TYPES[kind], offset: Math.min(Math.max(body.limit ?? 12, 1), 20) });
    const results = pois.map((poi) => ({
      id: poi.sourceId,
      name: poi.name,
      address: poi.address,
      lat: poi.lat,
      lng: poi.lng,
      image: poi.image,
      rating: poi.rating,
      reviewCount: poi.reviewCount,
      cost: poi.cost,
      score: valueScore(poi.rating, poi.reviewCount, poi.cost),
      insight: insight(poi.rating, poi.reviewCount, poi.cost),
      source: "amap" as const,
      sourceId: poi.sourceId,
      fetchedAt: new Date().toISOString(),
    })).sort((a, b) => b.score - a.score);
    const payload = { ok: true, status: "REAL", kind, city, query, results, fetchedAt: new Date().toISOString(), warning: "评分、人均消费和图片来自高德 POI；价格、房态、活动库存仍需以官方页面为准。" };
    cache.set(key, { data: payload, expiresAt: Date.now() + 5 * 60_000 });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ ok: false, status: "UNAVAILABLE", error: error instanceof Error ? error.message : "discover failed" }, { status: 502 });
  }
}
