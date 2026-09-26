import "server-only";

import { z } from "zod";
import { chongqingTrip } from "@/data/demo/chongqing";
import { uid } from "@/lib/utils";
import { estimateBudgetItems } from "@/services/ai/actions/executor";
import { recomputeTrip } from "@/services/routing";
import { amapSearchPois, isAmapConfigured, amapGeocode, amapWeather } from "@/services/map/amap-rest";
import { tripRepository } from "@/services/trips/repository";
import type { Day, Place, Trip } from "@/types/travel";
import { createTripId, planWithRules } from "@/services/planning/rule-planner";
import { weatherForDate } from "@/services/weather/merge";
import { resolveCityCoverImage } from "@/services/media/city-cover";
import { searchTravelSocial, type LiveSocialSearchResult } from "@/services/social/live-search";
import { persistSocialSearch } from "@/services/social/store";

export const dynamic = "force-dynamic";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");

const bodySchema = z.object({
  prompt: z.string().max(2000).optional(),
  origin: z.string().max(60).optional(),
  destination: z.string().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travelers: z.number().int().min(1).max(20).optional(),
  budget: z.number().min(0).max(1_000_000).optional(),
  vibes: z.array(z.string().max(20)).max(10).optional(),
});

const outlineSchema = z.object({
  title: z.string().min(1).max(60),
  dayPlans: z
    .array(
      z.object({
        title: z.string().max(40),
        summary: z.string().max(120),
        stops: z
          .array(
            z.object({
              placeId: z.string().min(1),
              startTime: hhmm,
              durationMinutes: z.number().int().min(15).max(480),
              meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(7),
  tasks: z.array(z.object({ title: z.string().min(1).max(60), group: z.enum(["before", "day"]) })).max(16).optional(),
});

type Outline = z.output<typeof outlineSchema>;
type Candidate = Place;

const DEFAULT_STAY: Record<string, number> = {
  attraction: 90,
  viewpoint: 60,
  food: 70,
  cafe: 50,
  hotel: 0,
  activity: 120,
  shopping: 90,
  transport: 40,
};

function categorize(type: string): Place["category"] {
  if (/景点|风景|名胜|公园|博物馆|纪念馆|古镇|遗址/.test(type)) return "attraction";
  if (/餐饮|美食|餐厅|小吃|火锅|面/.test(type)) return "food";
  if (/咖啡|茶座|奶茶/.test(type)) return "cafe";
  if (/酒店|宾馆|民宿|公寓/.test(type)) return "hotel";
  if (/购物|商场|百货|市场/.test(type)) return "shopping";
  if (/演出|剧场|影院|KTV|娱乐|体育|展/.test(type)) return "activity";
  return "attraction";
}

async function amapCandidates(destination: string): Promise<Candidate[]> {
  const groups: Array<{ keywords: string; category: Place["category"] }> = [
    { keywords: "景点", category: "attraction" },
    { keywords: "美食", category: "food" },
    { keywords: "咖啡", category: "cafe" },
    { keywords: "酒店", category: "hotel" },
    { keywords: "购物", category: "shopping" },
    { keywords: "展览 演出", category: "activity" },
  ];
  const failures: string[] = [];
  const results = await Promise.all(
    groups.map(async ({ keywords, category }) => {
      try {
        const pois = await amapSearchPois({ keywords, city: destination, offset: 12 });
        return pois.map((poi) =>
          toCandidate(poi, category === "food" ? categorize(poi.type) : category),
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "AMap POI request failed");
        return [] as Candidate[];
      }
    }),
  );
  const candidates = results.flat();
  if (!candidates.length && failures.length) throw new Error(failures[0]);
  return candidates;
}

function toCandidate(poi: { sourceId: string; name: string; address: string; lng: number; lat: number; rating?: number; cost?: number; type: string }, category: Place["category"]): Candidate {
  const priceLevel = poi.cost === undefined ? 1 : poi.cost === 0 ? 0 : poi.cost < 50 ? 1 : poi.cost < 150 ? 2 : 3;
  return {
    id: `amap-${poi.sourceId || uid("poi")}`,
    name: poi.name,
    category,
    lat: poi.lat,
    lng: poi.lng,
    rating: poi.rating ?? 4.2,
    reviewCount: 0,
    image: "",
    priceLevel: priceLevel as Place["priceLevel"],
    priceLabel: poi.cost ? `¥${Math.round(poi.cost)} / 人` : "免费",
    address: poi.address,
    openingStatus: "unknown",
    stayMinutes: DEFAULT_STAY[category] ?? 60,
    description: poi.type.split(";")[0] ?? "",
    tags: poi.type.split(";").filter(Boolean).slice(0, 2),
    district: "",
    source: "amap",
    sourceId: poi.sourceId,
    provenance: { source: "amap", estimated: false },
  };
}

function demoCandidates(): Candidate[] {
  return structuredClone(chongqingTrip.places).map((place) => ({ ...place, source: "demo" as const, provenance: { source: "demo" as const, estimated: true as const } }));
}

async function buildCandidates(destination: string): Promise<{ places: Candidate[]; provider: "amap" | "demo" }> {
  if (isAmapConfigured()) {
    const places = await amapCandidates(destination);
    const unique = [...new Map(places.filter((p) => p.sourceId && Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => [p.sourceId, p])).values()];
    if (unique.length >= 4) return { places: unique, provider: "amap" };
    throw new Error("NO_POI_RESULTS");
  }
  if (process.env.VOYAGE_DEMO_MODE === "true" && destination.includes("重庆")) {
    return { places: demoCandidates(), provider: "demo" };
  }
  throw new Error("NO_PROVIDER_CONFIGURED");
}

async function buildDays(startDate: string, endDate: string, tripId: string, destination: string): Promise<Day[]> {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const dayCount = Math.max(1, Math.min(7, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1));

  let forecasts: Array<{ date: string; tempC: number; condition: string; icon: "sun" | "cloud" | "rain" | "overcast" }> = [];
  if (isAmapConfigured()) {
    try {
      const geo = await amapGeocode(destination, destination);
      const casts = await amapWeather(geo.adcode || destination);
      forecasts = casts.map((c) => ({
        date: c.date,
        tempC: Math.round((c.dayTemp + c.nightTemp) / 2) || c.dayTemp,
        condition: c.dayWeather,
        icon: c.dayWeather.includes("雨")
          ? ("rain" as const)
          : c.dayWeather.includes("云")
            ? ("cloud" as const)
            : c.dayWeather.includes("阴")
              ? ("overcast" as const)
              : ("sun" as const),
      }));
    } catch {
      // ignore
    }
  }

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    const iso = date.toISOString().slice(0, 10);
    const weather = weatherForDate(forecasts, iso);
    return {
      id: `${tripId}-day-${index + 1}`,
      tripId,
      index,
      date: iso,
      title: "",
      summary: "",
      weather,
    };
  });
}

const SYSTEM_PROMPT = [
  "你是 Voyage 旅行规划器。根据用户需求，把候选地点排成每天可执行的行程。",
  '输出严格 JSON：{"title": "...", "dayPlans": [{"title", "summary", "stops": [{"placeId", "startTime": "HH:mm", "durationMinutes", "meal"?}]}], "tasks": [{"title", "group": "before"|"day"}]}',
  "规则：",
  "1. placeId 只能来自候选列表；绝不发明地点或坐标。",
  "2. 每天按地理就近排序，行程节奏参考用户偏好（轻松/特种兵）。",
  "3. 一天 4-7 个 stops，包含正餐（meal: lunch/dinner）。",
  "4. startTime 用 24 小时 HH:mm；第一天不早于火车/航班到达时间。",
].join("\n");

async function llmOutline(input: { prompt: string; candidates: Candidate[]; dayCount: number; budget: number; travelers: number; vibes: string[]; social?: LiveSocialSearchResult }): Promise<Outline> {
  const { chatJson } = await import("@/services/ai/llm");
  const candidateLines = input.candidates
    .map((p) => `${p.id} ${p.name} [${p.category}] (${p.district || p.address})`)
    .join("\n");
  const userMessage = [
    `用户需求：${input.prompt}`,
    `天数：${input.dayCount}，人数：${input.travelers}，预算：¥${input.budget}`,
    input.vibes.length ? `偏好：${input.vibes.join("、")}` : "",
    "",
    "候选地点：",
    candidateLines,
    input.social?.signals.length ? "\n社交平台信号（仅作参考，不得创建候选地点或替代高德事实）：" : "",
    ...(input.social?.signals ?? []).map((signal) => `${signal.signalType}=${signal.signalType === "travel_warning" ? "reported; see source evidence" : JSON.stringify(signal.value)} confidence=${signal.confidence.toFixed(2)} sources=${signal.sources.length}`),
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await chatJson({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    maxTokens: 3500,
  });
  const parsed = outlineSchema.safeParse(raw);
  if (!parsed.success) throw new Error("LLM outline failed schema validation");
  return parsed.data;
}

async function assembleTrip(input: {
  outline: Outline;
  body: z.output<typeof bodySchema>;
  candidates: Candidate[];
  social?: LiveSocialSearchResult;
}): Promise<Trip> {
  const { body, candidates, social } = input;
  const tripId = createTripId();
  const days = await buildDays(body.startDate, body.endDate, tripId, body.destination);
  const outline = input.outline;
  const places: Place[] = [];
  const items: Trip["items"] = [];

  days.forEach((day, dayIndex) => {
    const plan = outline?.dayPlans[dayIndex];
    day.title = plan?.title ?? `${body.destination} · Day ${dayIndex + 1}`;
    day.summary = plan?.summary ?? "";
    (plan?.stops ?? []).forEach((stop, index) => {
      const candidate = candidates.find((p) => p.id === stop.placeId);
      if (!candidate) return;
      if (!places.some((p) => p.id === candidate.id)) places.push(candidate);
      items.push({
        id: `it-${dayIndex + 1}-${index + 1}`,
        dayId: day.id,
        type:
          candidate.category === "food" || candidate.category === "cafe"
            ? "food"
            : candidate.category === "hotel"
              ? "hotel"
              : candidate.category === "activity"
                ? "activity"
                : "place",
        placeId: candidate.id,
        startTime: stop.startTime,
        duration: stop.durationMinutes,
        order: index,
        status: "planned",
        ...(stop.meal ? { meal: stop.meal } : {}),
      });
    });
  });

  const estimatedSpend = Math.round((body.budget ?? 2500) * 0.85);
  const trip: Trip = {
    id: tripId,
    title: outline?.title ?? `${body.destination} · ${days.length} 天`,
    destination: body.destination,
    origin: body.origin ?? "",
    startDate: body.startDate,
    endDate: body.endDate,
    travelers: body.travelers ?? 2,
    budget: body.budget ?? 2500,
    currency: "CNY",
    status: "ready",
    estimatedSpend,
    coverImage: (candidates.find((candidate) => candidate.image)?.image || await resolveCityCoverImage(body.destination, candidates)),
    vibe: body.vibes ?? [],
    prompt: body.prompt ?? "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    days,
    items,
    segments: [],
    places,
    hotels: [],
    restaurants: [],
    activities: [],
    transports: [],
    tasks: (outline.tasks ?? []).map((task, index) => ({
      id: `tk-${index + 1}`,
      tripId,
      title: task.title,
      group: task.group,
      status: "todo" as const,
    })),
    budgetItems: [],
    ...(social ? { socialQueryId: social.queryId, socialEvidence: social.evidence, socialSignals: social.signals, socialWarnings: social.warnings } : {}),
  };
  const withBudget = estimateBudgetItems({ ...trip, estimatedSpend: Math.max(300, estimatedSpend) });
  return recomputeTrip(withBudget);
}

function ruleOutline(body: z.output<typeof bodySchema>, candidates: Candidate[]): Outline {
  const plan = planWithRules({
    destination: body.destination,
    startDate: body.startDate,
    endDate: body.endDate,
    travelers: body.travelers ?? 2,
    budget: body.budget ?? 2500,
    vibes: body.vibes ?? [],
    candidates,
  });
  return { ...plan, tasks: [] };
}

async function llmOutlineSafe(body: z.output<typeof bodySchema>, candidates: Candidate[], social?: LiveSocialSearchResult): Promise<Outline | undefined> {
  try {
    const dayCount = Math.max(1, Math.min(7, Math.floor((new Date(`${body.endDate}T12:00:00`).getTime() - new Date(`${body.startDate}T12:00:00`).getTime()) / 86_400_000) + 1));
    return await llmOutline({
      prompt: body.prompt ?? "",
      candidates,
      dayCount,
      budget: body.budget ?? 2500,
      travelers: body.travelers ?? 2,
      vibes: body.vibes ?? [],
      social,
    });
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid body", detail: body.error.flatten() }, { status: 400 });
  }

  const llmEnv = process.env.LLM_BASE_URL;
  let candidates: Candidate[];
  let provider: "amap" | "demo";
  try {
    const built = await buildCandidates(body.data.destination);
    candidates = built.places;
    provider = built.provider;
  } catch (error) {
    const message = error instanceof Error ? error.message : "candidate lookup failed";
    const errorCode = /INVALID_USER_KEY|USERKEY_PLAT_NOMATCH/.test(message)
      ? "AMAP_INVALID_USER_KEY"
      : message === "NO_POI_RESULTS"
        ? "NO_POI_RESULTS"
        : message === "NO_PROVIDER_CONFIGURED"
          ? "NO_PROVIDER_CONFIGURED"
          : "AMAP_PROVIDER_ERROR";
    return Response.json(
      { error: errorCode, detail: errorCode === "AMAP_INVALID_USER_KEY" ? "AMAP_SERVER_KEY 无效、未开通 Web 服务或 Key 与平台类型不匹配" : message },
      { status: 503 },
    );
  }

  let social: LiveSocialSearchResult | undefined;
  if (process.env.NODE_ENV !== "test" && process.env.VOYAGE_SOCIAL_ENABLED !== "0") {
    try {
      social = await searchTravelSocial({ city: body.data.destination, query: body.data.prompt });
      await persistSocialSearch(social).catch((error) => {
        social?.warnings.push(error instanceof Error ? error.message : "Social evidence could not be saved");
      });
    } catch {
      social = undefined;
    }
  }

  const outline = llmEnv ? await llmOutlineSafe(body.data, candidates, social) : undefined;
  const trip = await assembleTrip({ outline: outline ?? ruleOutline(body.data, candidates), body: body.data, candidates, social });
  try {
    const saved = await tripRepository.save(trip);
    return Response.json({ source: outline ? "llm" : "rules", mapProvider: provider, trip: saved });
  } catch (error) {
    return Response.json(
      {
        source: outline ? "llm" : "rules",
        mapProvider: provider,
        trip,
        persistError: error instanceof Error ? error.message : "persist failed",
      },
      { status: 200 },
    );
  }
}
