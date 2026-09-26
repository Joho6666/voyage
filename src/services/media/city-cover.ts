import type { Place } from "@/types/travel";

const cache = new Map<string, { expiresAt: number; url?: string }>();

function validImage(value: unknown) {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : undefined;
}

/** Resolve a real city image without putting a scraper or provider token in the browser. */
export async function resolveCityCoverImage(city: string, places: Place[] = []): Promise<string> {
  const fromPoi = places.map((place) => validImage(place.image)).find(Boolean);
  if (fromPoi) return fromPoi;
  const key = city.trim();
  if (!key) return "";
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url ?? "";
  const deadline = Date.now() + 10_000;
  try {
    // Wikipedia's city summary endpoint is a more precise fallback than a
    // broad file search and returns a directly embeddable, licensed image.
    for (const title of [key, key.replace(/市$/, "")]) {
      if (!title) continue;
      const summaryUrl = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryResponse = await fetch(summaryUrl, {
        signal: AbortSignal.timeout(Math.min(3_500, Math.max(500, deadline - Date.now()))),
        headers: { accept: "application/json", "user-agent": "VoyageTravelApp/0.1 (city cover lookup)" },
      });
      if (!summaryResponse.ok) continue;
      const summary = await summaryResponse.json() as { originalimage?: { source?: string }; thumbnail?: { source?: string } };
      const image = validImage(summary.thumbnail?.source) ?? validImage(summary.originalimage?.source);
      if (image) {
        cache.set(key, { expiresAt: Date.now() + 30 * 60_000, url: image });
        return image;
      }
    }
    // Search a few progressively broader Wikimedia queries. Chinese city names
    // often have no exact English file-title match, while "China landmark"
    // reliably finds a licensed city image for the same destination.
    const queries = [`${key} city landmark`, `${key} China landmark`, `${key} skyline`];
    for (const query of queries) {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.searchParams.set("action", "query");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", query);
      url.searchParams.set("gsrnamespace", "6");
      url.searchParams.set("gsrlimit", "8");
      url.searchParams.set("prop", "imageinfo");
      url.searchParams.set("iiprop", "url");
      url.searchParams.set("iiurlwidth", "1400");
      url.searchParams.set("format", "json");
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(4_000, Math.max(500, deadline - Date.now()))),
        headers: { accept: "application/json", "user-agent": "VoyageTravelApp/0.1 (city cover lookup)" },
      });
      if (!response.ok) continue;
      const data = await response.json() as { query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; url?: string }> }> } };
      const image = Object.values(data.query?.pages ?? [])
        .map((page) => validImage(page.imageinfo?.[0]?.thumburl) ?? validImage(page.imageinfo?.[0]?.url))
        .find(Boolean);
      if (image) {
        cache.set(key, { expiresAt: Date.now() + 30 * 60_000, url: image });
        return image;
      }
    }
    cache.set(key, { expiresAt: Date.now() + 5 * 60_000 });
    return "";
  } catch {
    cache.set(key, { expiresAt: Date.now() + 5 * 60_000 });
    return "";
  }
}
