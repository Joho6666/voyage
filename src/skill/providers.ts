import { readFile } from "node:fs/promises";
import {
  amapDrivingRoute,
  amapGeocode,
  amapSearchPois,
  amapTransitRoute,
  amapWalkingRoute,
  amapWeather,
  isAmapConfigured,
  type AmapRouteResult,
} from "@/services/map/amap-rest";
import type { Place, PlaceCategory } from "@/types/travel";
import { SkillError } from "./errors";

export interface ProviderForecast {
  date: string;
  tempC: number;
  condition: string;
  icon: "sun" | "cloud" | "rain" | "overcast";
  source: "amap" | "mock";
}

export interface ProviderRoute extends AmapRouteResult {
  source: "amap" | "mock";
  mode: "walk" | "metro" | "bus" | "taxi" | "drive";
}

export interface TravelDataProvider {
  readonly kind: "amap" | "mock";
  searchPlaces(input: { destination: string; query: string; category?: PlaceCategory; limit: number }): Promise<Place[]>;
  getWeather(destination: string): Promise<ProviderForecast[]>;
  planRoute(input: {
    origin: { lng: number; lat: number };
    destination: { lng: number; lat: number };
    mode: "walk" | "metro" | "bus" | "taxi" | "drive";
    city: string;
  }): Promise<ProviderRoute>;
}

const DEFAULT_STAY: Record<PlaceCategory, number> = {
  attraction: 90,
  viewpoint: 60,
  food: 70,
  cafe: 50,
  hotel: 0,
  activity: 120,
  shopping: 90,
  transport: 40,
};

export function inferCategory(type: string, fallback: PlaceCategory = "attraction"): PlaceCategory {
  if (/餐饮|美食|餐厅|小吃|火锅|面/.test(type)) return "food";
  if (/咖啡|茶座|奶茶/.test(type)) return "cafe";
  if (/酒店|宾馆|民宿|公寓/.test(type)) return "hotel";
  if (/购物|商场|百货|市场/.test(type)) return "shopping";
  if (/演出|剧场|影院|KTV|娱乐|体育|展览/.test(type)) return "activity";
  if (/观景|夜景/.test(type)) return "viewpoint";
  if (/车站|机场|码头/.test(type)) return "transport";
  return fallback;
}

export class AmapTravelProvider implements TravelDataProvider {
  readonly kind = "amap" as const;

  constructor() {
    if (!isAmapConfigured()) throw new SkillError("NO_PROVIDER_CONFIGURED", "AMAP_SERVER_KEY is not configured");
  }

  async searchPlaces(input: { destination: string; query: string; category?: PlaceCategory; limit: number }) {
    const pois = await amapSearchPois({ keywords: input.query, city: input.destination, offset: input.limit });
    return pois
      .filter((poi) => poi.sourceId && Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
      .map((poi) => {
        const category = input.category ?? inferCategory(poi.type);
        const priceLevel = poi.cost === undefined ? 1 : poi.cost === 0 ? 0 : poi.cost < 50 ? 1 : poi.cost < 150 ? 2 : 3;
        return {
          id: `amap-${poi.sourceId}`,
          name: poi.name,
          category,
          lat: poi.lat,
          lng: poi.lng,
          rating: poi.rating ?? 0,
          reviewCount: 0,
          image: "",
          priceLevel: priceLevel as Place["priceLevel"],
          priceLabel: poi.cost === undefined ? undefined : poi.cost === 0 ? "免费" : `¥${Math.round(poi.cost)} / 人`,
          address: poi.address,
          openingStatus: "unknown" as const,
          stayMinutes: DEFAULT_STAY[category],
          description: poi.type.split(";")[0] ?? "",
          tags: poi.type.split(";").filter(Boolean).slice(0, 4),
          district: "",
          estimatedCost: poi.cost,
          source: "amap" as const,
          sourceId: poi.sourceId,
          provenance: { source: "amap" as const, estimated: false as const },
        };
      });
  }

  async getWeather(destination: string): Promise<ProviderForecast[]> {
    const geo = await amapGeocode(destination, destination);
    const casts = await amapWeather(geo.adcode || destination);
    return casts.map((cast) => ({
      date: cast.date,
      tempC: Math.round((cast.dayTemp + cast.nightTemp) / 2) || cast.dayTemp,
      condition: cast.dayWeather,
      icon: cast.dayWeather.includes("雨") ? "rain" : cast.dayWeather.includes("云") ? "cloud" : cast.dayWeather.includes("阴") ? "overcast" : "sun",
      source: "amap",
    }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]): Promise<ProviderRoute> {
    let route: AmapRouteResult;
    if (input.mode === "walk") route = await amapWalkingRoute(input.origin, input.destination);
    else if (input.mode === "metro" || input.mode === "bus") route = await amapTransitRoute(input.origin, input.destination, input.city);
    else route = await amapDrivingRoute(input.origin, input.destination);
    return { ...route, source: "amap", mode: input.mode };
  }
}

interface FixtureFile {
  places: Place[];
  weather: ProviderForecast[];
  route?: Omit<ProviderRoute, "source">;
}

export class FixtureTravelProvider implements TravelDataProvider {
  readonly kind = "mock" as const;
  constructor(private readonly fixture: FixtureFile) {}

  static async fromFile(file: string) {
    return new FixtureTravelProvider(JSON.parse(await readFile(file, "utf8")) as FixtureFile);
  }

  async searchPlaces(input: { destination: string; query: string; category?: PlaceCategory; limit: number }): Promise<Place[]> {
    const query = input.query.toLowerCase();
    return this.fixture.places
      .filter((place) => !input.category || place.category === input.category)
      .filter((place) => !query || [place.name, place.category, ...place.tags].join(" ").toLowerCase().includes(query) || /景点|室内|展览/.test(query))
      .slice(0, input.limit)
      .map((place) => ({ ...place, source: "demo" as const, provenance: { source: "demo" as const, estimated: true as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((item) => ({ ...item, source: "mock" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]): Promise<ProviderRoute> {
    if (this.fixture.route) return { ...this.fixture.route, source: "mock", mode: input.mode };
    throw new SkillError("ROUTE_PROVIDER_UNAVAILABLE", "Fixture route is unavailable");
  }
}

export async function providerFromEnvironment() {
  const fixture = process.env.VOYAGE_PROVIDER_FIXTURE;
  if (fixture) {
    if (process.env.VOYAGE_ALLOW_MOCK !== "1") {
      throw new SkillError("NO_PROVIDER_CONFIGURED", "VOYAGE_ALLOW_MOCK=1 is required for fixture mode");
    }
    return FixtureTravelProvider.fromFile(fixture);
  }
  return new AmapTravelProvider();
}
