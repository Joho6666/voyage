const AMAP_HOST = "restapi.amap.com";

export interface AmapPoi {
  sourceId: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  type: string;
  tel?: string;
  rating?: number;
  cost?: number;
  image?: string;
}

export interface AmapRouteStep {
  instruction: string;
  distanceMeters: number;
  durationMinutes: number;
  polyline?: Array<[number, number]>;
}

export interface AmapRouteResult {
  distanceMeters: number;
  durationMinutes: number;
  polyline: Array<[number, number]>;
  steps: AmapRouteStep[];
}

function serverKey() {
  return process.env.AMAP_SERVER_KEY ?? "";
}

export function isAmapConfigured() {
  return Boolean(serverKey());
}

async function amapGet(path: string, params: Record<string, string>) {
  const key = serverKey();
  if (!key) throw new Error("AMap server key is not configured");
  const url = new URL(`https://${AMAP_HOST}${path}`);
  Object.entries({ key, ...params }).forEach(([name, value]) => {
    url.searchParams.set(name, value);
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`AMap request failed: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

function parseLocation(location: unknown): { lng: number; lat: number } | null {
  if (typeof location !== "string") return null;
  const parts = location.split(",");
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

export async function amapSearchPois(params: {
  keywords: string;
  city: string;
  types?: string;
  offset?: number;
}): Promise<AmapPoi[]> {
  const data = await amapGet("/v3/place/text", {
    keywords: params.keywords,
    city: params.city,
    citylimit: "true",
    offset: String(params.offset ?? 15),
    page: "1",
    extensions: "all",
    ...(params.types ? { types: params.types } : {}),
  });
  if (data.status !== "1") throw new Error(`AMap search failed: ${String(data.info ?? "unknown")}`);
  const pois = Array.isArray(data.pois) ? data.pois : [];
  const results: AmapPoi[] = [];
  for (const poi of pois) {
    const record = poi as Record<string, unknown>;
    const location = parseLocation(record.location);
    if (!location) continue;
    const biz = record.biz_ext as Record<string, unknown> | undefined;
    const photos = Array.isArray(record.photos) ? record.photos as Record<string, unknown>[] : [];
    const image = photos.map((photo) => photo.url).find((url): url is string => typeof url === "string" && /^https:\/\//.test(url));
    const ratingRaw = biz && typeof biz.rating === "string" ? Number(biz.rating) : NaN;
    const costRaw = biz && typeof biz.cost === "string" ? Number(biz.cost) : NaN;
    results.push({
      sourceId: String(record.id ?? ""),
      name: String(record.name ?? "").replace(/<[^>]+>/g, ""),
      address: String(record.address ?? ""),
      lng: location.lng,
      lat: location.lat,
      type: String(record.type ?? ""),
      tel: typeof record.tel === "string" ? record.tel : undefined,
      rating: Number.isFinite(ratingRaw) ? ratingRaw : undefined,
      cost: Number.isFinite(costRaw) ? costRaw : undefined,
      image,
    });
  }
  return results;
}

export async function amapGeocode(address: string, city?: string) {
  const data = await amapGet("/v3/geocode/geo", { address, ...(city ? { city } : {}) });
  if (data.status !== "1") throw new Error(`AMap geocode failed: ${String(data.info ?? "unknown")}`);
  const geocodes = Array.isArray(data.geocodes) ? data.geocodes : [];
  const first = geocodes[0] as Record<string, unknown> | undefined;
  const location = first ? parseLocation(first.location) : null;
  if (!location) throw new Error("AMap geocode returned no result");
  return { ...location, adcode: String(first?.adcode ?? ""), district: String(first?.district ?? "") };
}

export async function amapReverseGeocode(lat: number, lng: number) {
  const data = await amapGet("/v3/geocode/regeo", {
    location: `${lng},${lat}`,
    extensions: "base",
  });
  if (data.status !== "1") throw new Error(`AMap reverse geocode failed: ${String(data.info ?? "unknown")}`);
  const regeocode = data.regeocode as Record<string, unknown> | undefined;
  const addressComponent = regeocode?.addressComponent as Record<string, unknown> | undefined;
  return {
    formattedAddress: String(regeocode?.formatted_address ?? ""),
    province: String(addressComponent?.province ?? ""),
    city: String(addressComponent?.city ?? ""),
    district: String(addressComponent?.district ?? ""),
    township: String(addressComponent?.township ?? ""),
  };
}

function parsePolyline(polyline: unknown): Array<[number, number]> {
  if (typeof polyline !== "string") return [];
  const points: Array<[number, number]> = [];
  polyline.split(";").forEach((pair) => {
    const parts = pair.split(",");
    if (parts.length === 2) {
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) points.push([lng, lat]);
    }
  });
  return points;
}

export async function amapWalkingRoute(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
): Promise<AmapRouteResult> {
  const data = await amapGet("/v3/direction/walking", {
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
  });
  if (data.status !== "1") throw new Error("AMap walking route failed");
  const paths = ((data.route as Record<string, unknown>)?.paths ?? []) as Record<string, unknown>[];
  const path = paths[0];
  if (!path) throw new Error("AMap walking route empty");
  const rawSteps = Array.isArray(path.steps) ? (path.steps as Record<string, unknown>[]) : [];
  const steps: AmapRouteStep[] = rawSteps.map((step) => {
    const poly = parsePolyline(step.polyline);
    return {
      instruction: String(step.instruction ?? "").replace(/<[^>]+>/g, ""),
      distanceMeters: Number(step.distance ?? 0),
      durationMinutes: Math.round(Number(step.duration ?? 0) / 60),
      polyline: poly,
    };
  });
  const polyline = steps.flatMap((s) => s.polyline ?? []);
  return {
    distanceMeters: Number(path.distance ?? 0),
    durationMinutes: Math.round(Number(path.duration ?? 0) / 60),
    polyline,
    steps,
  };
}

export async function amapDrivingRoute(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
): Promise<AmapRouteResult> {
  const data = await amapGet("/v3/direction/driving", {
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    strategy: "0",
    extensions: "all",
  });
  if (data.status !== "1") throw new Error("AMap driving route failed");
  const paths = ((data.route as Record<string, unknown>)?.paths ?? []) as Record<string, unknown>[];
  const path = paths[0];
  if (!path) throw new Error("AMap driving route empty");
  const rawSteps = Array.isArray(path.steps) ? (path.steps as Record<string, unknown>[]) : [];
  const steps: AmapRouteStep[] = rawSteps.map((step) => {
    const poly = parsePolyline(step.polyline);
    return {
      instruction: String(step.instruction ?? "").replace(/<[^>]+>/g, ""),
      distanceMeters: Number(step.distance ?? 0),
      durationMinutes: Math.round(Number(step.duration ?? 0) / 60),
      polyline: poly,
    };
  });
  const polyline = steps.flatMap((s) => s.polyline ?? []);
  return {
    distanceMeters: Number(path.distance ?? 0),
    durationMinutes: Math.round(Number(path.duration ?? 0) / 60),
    polyline,
    steps,
  };
}

export async function amapTransitRoute(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
  city: string,
): Promise<AmapRouteResult> {
  const data = await amapGet("/v3/direction/transit/integrated", {
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    city,
    strategy: "0",
  });
  if (data.status !== "1") throw new Error("AMap transit route failed");
  const route = data.route as Record<string, unknown> | undefined;
  const transits = Array.isArray(route?.transits) ? (route?.transits as Record<string, unknown>[]) : [];
  const first = transits[0];
  if (!first) throw new Error("AMap transit route empty");
  const segments = Array.isArray(first.segments) ? (first.segments as Record<string, unknown>[]) : [];
  const steps: AmapRouteStep[] = [];
  const polyline: Array<[number, number]> = [];

  for (const seg of segments) {
    const walking = seg.walking as Record<string, unknown> | undefined;
    if (walking && Array.isArray(walking.steps)) {
      for (const wStep of walking.steps as Record<string, unknown>[]) {
        const poly = parsePolyline(wStep.polyline);
        polyline.push(...poly);
        steps.push({
          instruction: String(wStep.instruction ?? "").replace(/<[^>]+>/g, ""),
          distanceMeters: Number(wStep.distance ?? 0),
          durationMinutes: Math.round(Number(wStep.duration ?? 0) / 60),
          polyline: poly,
        });
      }
    }
    const bus = seg.bus as Record<string, unknown> | undefined;
    const buslines = Array.isArray(bus?.buslines) ? (bus?.buslines as Record<string, unknown>[]) : [];
    if (buslines[0]) {
      const b = buslines[0];
      const poly = parsePolyline(b.polyline);
      polyline.push(...poly);
      steps.push({
        instruction: `乘坐 ${String(b.name ?? "公共交通")}`,
        distanceMeters: Number(b.distance ?? 0),
        durationMinutes: Math.round(Number(b.duration ?? 0) / 60),
        polyline: poly,
      });
    }
  }

  return {
    distanceMeters: Number(route?.distance ?? 0),
    durationMinutes: Math.round(Number(first.duration ?? 0) / 60),
    polyline,
    steps,
  };
}

export async function amapWeather(cityAdcode: string) {
  const data = await amapGet("/v3/weather/weatherInfo", { city: cityAdcode, extensions: "all" });
  if (data.status !== "1") throw new Error("AMap weather failed");
  const forecasts = Array.isArray(data.forecasts) ? (data.forecasts as Record<string, unknown>[]) : [];
  const first = forecasts[0];
  if (!first) throw new Error("AMap weather empty");
  const casts = Array.isArray(first.casts) ? (first.casts as Record<string, unknown>[]) : [];
  return casts.map((cast) => ({
    date: String(cast.date ?? ""),
    dayTemp: Number(cast.daytemp ?? 0),
    nightTemp: Number(cast.nighttemp ?? 0),
    dayWeather: String(cast.dayweather ?? ""),
    nightWeather: String(cast.nightweather ?? ""),
  }));
}
