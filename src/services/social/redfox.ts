import { SocialProviderRequestError, createSocialAdapter, type SocialRequestTransport } from "./provider";
import type { SocialProvider } from "./provider";
import type { SocialProviderResult, SocialSearchInput } from "./types";
import { runtimeConfigSync } from "@/services/config/local-credentials";

const REDFOX_URL = "https://redfox.hk/story/api/dyData/searchUser";
const TIMEOUT_MS = 12_000;

export interface RedFoxDouyinAccount {
  accountId: string;
  nickname: string;
  signature?: string;
  city?: string;
  followerCount?: number;
  awemeCount?: number;
  totalFavorited?: number;
  crawlTime?: string;
  redfoxIndex?: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mapAccount(value: unknown): RedFoxDouyinAccount | null {
  const row = object(value);
  if (!row) return null;
  const accountId = row.accountId ?? row.uid;
  const nickname = row.nickname;
  if (typeof accountId !== "string" || !accountId || typeof nickname !== "string" || !nickname) return null;
  const result: RedFoxDouyinAccount = { accountId, nickname };
  for (const key of ["signature", "city", "crawlTime"] as const) {
    if (typeof row[key] === "string") result[key] = row[key] as string;
  }
  for (const key of ["followerCount", "awemeCount", "totalFavorited", "redfoxIndex"] as const) {
    const number = typeof row[key] === "number" ? row[key] : Number(row[key]);
    if (Number.isFinite(number)) result[key] = number;
  }
  return result;
}

export async function searchRedFoxDouyinAccounts(input: {
  apiKey: string;
  keyword: string;
  offset?: number;
  sortType?: "_0" | "_2" | "_4";
  fetchImpl?: typeof fetch;
}): Promise<{ accounts: RedFoxDouyinAccount[]; total: number; hasMore: boolean }> {
  const keyword = input.keyword.trim();
  if (!keyword) throw new SocialProviderRequestError("RedFox account search requires a keyword");
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchImpl(REDFOX_URL, {
      method: "POST",
      headers: { REDFOX_API_KEY: input.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ keyword, offset: input.offset ?? 0, sortType: input.sortType ?? "_0" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status !== 429 || attempt === 1) break;
    const retryAfter = Number(response.headers.get("retry-after") ?? 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000, 2000)));
  }
  if (!response) throw new SocialProviderRequestError("RedFox request failed without a response");
  if (response.status === 429) throw new SocialProviderRequestError("RedFox rate limit exceeded after one retry; retry later");
  if (response.status === 401 || response.status === 403) throw new SocialProviderRequestError(`RedFox authorization or endpoint access denied (HTTP ${response.status})`);
  if (!response.ok) throw new SocialProviderRequestError(`RedFox request failed (HTTP ${response.status})`);
  const payload = object(await response.json());
  if (!payload) throw new SocialProviderRequestError("RedFox returned an invalid response");
  if (payload.code !== 2000) throw new SocialProviderRequestError(`RedFox rejected account search (code ${String(payload.code ?? "unknown")})`);
  const data = object(payload.data);
  const accounts = Array.isArray(data?.list) ? data.list.map(mapAccount).filter((item): item is RedFoxDouyinAccount => item !== null) : [];
  return {
    accounts,
    total: typeof data?.total === "number" ? data.total : accounts.length,
    hasMore: data?.hasMore === true || data?.hasMore === 1,
  };
}

export interface RedFoxSocialProvider extends SocialProvider {
  searchAccounts(input: SocialSearchInput & { offset?: number; sortType?: "_0" | "_2" | "_4" }): Promise<SocialProviderResult<RedFoxDouyinAccount[]>>;
}

export function createRedFoxProvider(options: {
  apiKey?: string;
  transport?: SocialRequestTransport;
  now?: () => Date;
  accountSearch?: typeof searchRedFoxDouyinAccounts;
} = {}): RedFoxSocialProvider {
  const apiKey = options.apiKey ?? runtimeConfigSync("REDFOX_API_KEY");
  const provider = createSocialAdapter({
    name: "redfox",
    platforms: ["xiaohongshu", "douyin", "wechat", "wechat_channels"],
    apiKey,
    transport: options.transport,
    supportedOperations: options.transport ? undefined : [],
    now: options.now,
  });
  return {
    ...provider,
    // The documented endpoint returns account profiles, not posts. Keep that
    // data separate from SocialObservation so it cannot be treated as content.
    async searchAccounts(input) {
      if (!apiKey) return { status: "unavailable", data: [], warnings: ["RedFox is not configured"] };
      if (input.platform && input.platform !== "douyin") return { status: "unavailable", data: [], warnings: ["RedFox account search only supports Douyin"] };
      try {
        const result = await (options.accountSearch ?? searchRedFoxDouyinAccounts)({
          apiKey,
          keyword: input.query ?? input.city,
          offset: input.offset,
          sortType: input.sortType,
        });
        return { status: "ok", data: result.accounts, warnings: ["RedFox returns T+1 Douyin account profiles; this is not social post content or a live trend feed"] };
      } catch (error) {
        return { status: "error", data: [], warnings: [error instanceof Error ? error.message : "RedFox request failed"] };
      }
    },
  };
}
