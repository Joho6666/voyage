import type { SocialProvider } from "./provider";
import type {
  SocialComment, SocialContentInput, SocialObservation, SocialPlatform,
  SocialProviderResult, SocialSearchInput,
} from "./types";

function combinedStatus(results: Array<SocialProviderResult<unknown>>) {
  if (results.some((result) => result.status === "ok")) return "ok" as const;
  if (results.some((result) => result.status === "error")) return "error" as const;
  return "unavailable" as const;
}

export class SocialProviderRouter {
  constructor(private readonly providers: readonly SocialProvider[]) {}

  private eligible(platform?: SocialPlatform) {
    return this.providers.filter((provider) => provider.configured && (!platform || provider.platforms.includes(platform)));
  }

  private async collect(
    method: "searchContent" | "getTrending",
    input: SocialSearchInput,
  ): Promise<SocialProviderResult<SocialObservation[]>> {
    const providers = this.eligible(input.platform);
    if (!providers.length) return { status: "unavailable", data: [], warnings: ["No social provider is configured for this platform"] };
    const results = await Promise.all(providers.map(async (provider) => {
      try { return await provider[method](input); }
      catch { return { status: "error" as const, data: [], warnings: [`${provider.name} request failed`] }; }
    }));
    const seen = new Set<string>();
    const data = results.flatMap((result) => result.data).filter((item) => {
      const key = `${item.provider}|${item.platform}|${item.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { status: combinedStatus(results), data, warnings: results.flatMap((result) => result.warnings) };
  }

  searchContent(input: SocialSearchInput) { return this.collect("searchContent", input); }
  getTrending(input: SocialSearchInput) { return this.collect("getTrending", input); }

  private async first<T>(
    input: SocialContentInput,
    method: "getContent" | "getComments",
    empty: T,
  ): Promise<SocialProviderResult<T>> {
    const providers = this.eligible(input.platform);
    if (!providers.length) return { status: "unavailable", data: empty, warnings: ["No social provider is configured for this platform"] };
    const warnings: string[] = [];
    for (const provider of providers) {
      try {
        const result = method === "getContent" ? await provider.getContent(input) : await provider.getComments(input);
        warnings.push(...result.warnings);
        if (result.status === "ok") return { status: "ok", data: result.data as T, warnings };
      } catch { warnings.push(`${provider.name} request failed`); }
    }
    return { status: "error", data: empty, warnings };
  }

  getContent(input: SocialContentInput): Promise<SocialProviderResult<SocialObservation | null>> {
    return this.first(input, "getContent", null);
  }

  getComments(input: SocialContentInput): Promise<SocialProviderResult<SocialComment[]>> {
    return this.first(input, "getComments", []);
  }
}
