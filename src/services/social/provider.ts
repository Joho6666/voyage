import type {
  SocialComment, SocialContentInput, SocialObservation, SocialPlatform,
  SocialProviderName, SocialProviderResult, SocialSearchInput,
} from "./types";

export interface SocialProvider {
  readonly name: SocialProviderName;
  readonly platforms: readonly SocialPlatform[];
  readonly configured: boolean;
  searchContent(input: SocialSearchInput): Promise<SocialProviderResult<SocialObservation[]>>;
  getContent(input: SocialContentInput): Promise<SocialProviderResult<SocialObservation | null>>;
  getComments(input: SocialContentInput): Promise<SocialProviderResult<SocialComment[]>>;
  getTrending(input: SocialSearchInput): Promise<SocialProviderResult<SocialObservation[]>>;
}

export type SocialOperation = "searchContent" | "getContent" | "getComments" | "getTrending";

/** The caller supplies a vetted API transport when a real endpoint contract is available. */
export type SocialRequestTransport = (request: {
  provider: SocialProviderName;
  operation: SocialOperation;
  apiKey: string;
  input: SocialSearchInput | SocialContentInput;
}) => Promise<unknown>;

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function nonempty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoDate(value: unknown): string | undefined {
  const date = nonempty(value);
  return date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined;
}

function rows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const item = record(value);
  if (!item) return [];
  for (const key of ["items", "results", "data", "comments"]) {
    if (Array.isArray(item[key])) return item[key] as unknown[];
  }
  return [value];
}

function normalizeObservation(
  value: unknown,
  provider: SocialProviderName,
  platforms: readonly SocialPlatform[],
  input: SocialSearchInput | SocialContentInput,
  now: Date,
): SocialObservation | null {
  const row = record(value);
  if (!row) return null;
  const sourceId = nonempty(row.sourceId ?? row.source_id ?? row.id);
  const content = nonempty(row.content ?? row.text ?? row.description ?? row.title);
  const platform = nonempty(row.platform) ?? input.platform;
  if (!sourceId || !content || !platform || !platforms.includes(platform as SocialPlatform)) return null;
  const rawMetrics = record(row.metrics) ?? {};
  const metrics = Object.fromEntries(Object.entries(rawMetrics).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isFinite(entry[1]),
  ));
  const city = nonempty(row.city) ?? input.city ?? "";
  const sourceUrl = nonempty(row.sourceUrl ?? row.source_url ?? row.url);
  return {
    provider, platform: platform as SocialPlatform, sourceId,
    ...(sourceUrl && /^https:\/\//i.test(sourceUrl) ? { sourceUrl } : {}),
    city,
    entityType: nonempty(row.entityType ?? row.entity_type),
    entityId: nonempty(row.entityId ?? row.entity_id),
    content, summary: nonempty(row.summary),
    publishedAt: isoDate(row.publishedAt ?? row.published_at),
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    metrics,
    rawMetadata: record(row.rawMetadata ?? row.raw_metadata) ?? {},
  };
}

function normalizeComment(value: unknown): SocialComment | null {
  const row = record(value);
  if (!row) return null;
  const id = nonempty(row.id ?? row.sourceId ?? row.source_id);
  const content = nonempty(row.content ?? row.text);
  return id && content ? { id, content, publishedAt: isoDate(row.publishedAt ?? row.published_at) } : null;
}

export function createSocialAdapter(input: {
  name: SocialProviderName;
  platforms: readonly SocialPlatform[];
  apiKey?: string;
  transport?: SocialRequestTransport;
  now?: () => Date;
}): SocialProvider {
  const apiKey = input.apiKey?.trim() ?? "";
  const configured = Boolean(apiKey && input.transport);
  const now = input.now ?? (() => new Date());

  async function request(operation: SocialOperation, args: SocialSearchInput | SocialContentInput): Promise<SocialProviderResult<unknown>> {
    if (!configured || !input.transport) return { status: "unavailable", data: null, warnings: [`${input.name} is not configured`] };
    if (args.platform && !input.platforms.includes(args.platform)) {
      return { status: "unavailable", data: null, warnings: [`${input.name} does not support ${args.platform}`] };
    }
    try {
      return { status: "ok", data: await input.transport({ provider: input.name, operation, apiKey, input: args }), warnings: [] };
    } catch {
      return { status: "error", data: null, warnings: [`${input.name} request failed`] };
    }
  }

  async function contentList(operation: "searchContent" | "getTrending", args: SocialSearchInput): Promise<SocialProviderResult<SocialObservation[]>> {
    const result = await request(operation, args);
    return { status: result.status, warnings: result.warnings,
      data: rows(result.data).flatMap((row) => {
        const item = normalizeObservation(row, input.name, input.platforms, args, now());
        return item ? [item] : [];
      }),
    };
  }

  return {
    name: input.name, platforms: input.platforms, configured,
    searchContent: (args) => contentList("searchContent", args),
    getTrending: (args) => contentList("getTrending", args),
    async getContent(args) {
      const result = await request("getContent", args);
      const item = rows(result.data).map((row) => normalizeObservation(row, input.name, input.platforms, args, now())).find(Boolean) ?? null;
      return { status: result.status, warnings: result.warnings, data: item };
    },
    async getComments(args) {
      const result = await request("getComments", args);
      return { status: result.status, warnings: result.warnings,
        data: rows(result.data).flatMap((row) => {
          const item = normalizeComment(row);
          return item ? [item] : [];
        }),
      };
    },
  };
}
