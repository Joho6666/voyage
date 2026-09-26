import type { TravelKnowledgeMatch, TravelKnowledgeRecord } from "./types";

const BUILTIN_KNOWLEDGE: TravelKnowledgeRecord[] = [
  {
    id: "cq-terrain-001",
    kind: "city_rule",
    city: "重庆",
    title: "山城地形不应只按平面距离评估步行",
    content: "重庆核心城区坡地、台阶和高差较多。短距离步行仍可能产生较高体力负担，连续景点间应同时考虑高差、台阶、换乘和疲劳状态。",
    tags: ["terrain", "walking", "fatigue", "accessibility"],
    confidence: 0.95,
    source: "curated",
    updatedAt: "2026-09-24T00:00:00.000Z",
  },
  {
    id: "cq-night-001",
    kind: "poi_knowledge",
    city: "重庆",
    title: "洪崖洞夜景时段需要预留人流缓冲",
    content: "洪崖洞夜间更适合安排夜景，但高峰时段人流密集。到达和离开时应为步行、排队和换乘增加缓冲，并避免在前一站安排过长停留。",
    tags: ["洪崖洞", "night", "crowd", "buffer"],
    confidence: 0.90,
    source: "curated",
    updatedAt: "2026-09-24T00:00:00.000Z",
  },
  {
    id: "urban-rain-001",
    kind: "transport_rule",
    city: "*",
    title: "雨天降低露天步行权重",
    content: "当实时天气为降雨时，优先降低长距离步行方案评分，并提高地铁、公交和短途出租车等低暴露方案权重。",
    tags: ["rain", "weather", "transport", "walking"],
    confidence: 0.97,
    source: "curated",
    updatedAt: "2026-09-24T00:00:00.000Z",
  },
  {
    id: "urban-luggage-001",
    kind: "transport_rule",
    city: "*",
    title: "携带行李时减少换乘和步行",
    content: "携带行李时，路线评分应显著提高步行和换乘惩罚。跨站换乘、长距离步行和复杂垂直交通不应仅因费用更低而被优先推荐。",
    tags: ["luggage", "transfer", "walking", "comfort"],
    confidence: 0.96,
    source: "curated",
    updatedAt: "2026-09-24T00:00:00.000Z",
  },
  {
    id: "student-budget-001",
    kind: "route_case",
    city: "*",
    title: "预算敏感用户优先公共交通但保留疲劳例外",
    content: "预算敏感用户通常优先公交和地铁，但当疲劳高、天气差、行李重或时间紧张时，短途出租车可能具有更高综合效用。",
    tags: ["budget", "student", "metro", "bus", "taxi"],
    confidence: 0.88,
    source: "curated",
    updatedAt: "2026-09-24T00:00:00.000Z",
  },
];

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[\s,，。；;、/|:_-]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function overlap(query: Set<string>, record: TravelKnowledgeRecord) {
  const body = tokenize([record.title, record.content, ...record.tags].join(" "));
  let hits = 0;
  query.forEach((token) => {
    if (body.has(token) || [...body].some((candidate) => candidate.includes(token) || token.includes(candidate))) hits += 1;
  });
  return hits / Math.max(1, query.size);
}

export function retrieveTravelKnowledge(input: {
  city: string;
  query: string;
  tags?: string[];
  limit?: number;
}): TravelKnowledgeMatch[] {
  const query = tokenize([input.query, ...(input.tags ?? [])].join(" "));
  const now = new Date();

  return BUILTIN_KNOWLEDGE
    .filter((record) => record.city === "*" || record.city === input.city)
    .filter((record) => !record.validFrom || new Date(record.validFrom) <= now)
    .filter((record) => !record.validTo || new Date(record.validTo) >= now)
    .map((record) => {
      const tagBoost = (input.tags ?? []).filter((tag) => record.tags.includes(tag)).length * 0.12;
      const cityBoost = record.city === input.city ? 0.10 : 0;
      const relevance = Math.min(1, overlap(query, record) * 0.75 + tagBoost + cityBoost + record.confidence * 0.10);
      return { ...record, relevance };
    })
    .filter((record) => record.relevance > 0.05)
    .sort((a, b) => b.relevance - a.relevance || b.confidence - a.confidence)
    .slice(0, input.limit ?? 8);
}
