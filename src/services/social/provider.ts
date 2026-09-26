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

export class SocialProviderRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialProviderRequestError";
  }
}

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
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : undefined;
  }
  const date = nonempty(value);
  if (!date) return undefined;
  if (/^\d{10,13}$/.test(date)) return isoDate(Number(date));
  return Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined;
}

function rows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const item = record(entry);
    if (item && !item.note_card && !item.mblog && (Array.isArray(item.items) || Array.isArray(item.list))) return rows(item.items ?? item.list);
    return [entry];
  });
  const item = record(value);
  if (!item) return [];
  for (const key of ["items", "results", "comments", "aweme_list", "video_list", "item_list", "search_list", "list", "item", "data", "aweme_info"]) {
    const nested = item[key];
    if (Array.isArray(nested)) return rows(nested);
    if (record(nested)) {
      const nestedRows = rows(nested);
      if (nestedRows.length) return nestedRows;
    }
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
  // Wrapped containers per platform generation: douyin aweme_info, xiaohongshu
  // app_v2 `note`, legacy note_card, weibo card `data`, generic item/video/card.
  const wrapped = record(row.item) ?? record(row.aweme_info) ?? record(row.video) ?? record(row.note) ?? record(row.note_card) ?? record(row.mblog) ?? record(row.data) ?? record(row.card) ?? row;
  const sourceId = nonempty(wrapped.sourceId ?? wrapped.source_id ?? wrapped.aweme_id ?? wrapped.note_id ?? wrapped.docID ?? wrapped.itemId ?? wrapped.id);
  const rawContent = nonempty(wrapped.content ?? wrapped.text_raw ?? wrapped.text ?? wrapped.desc ?? wrapped.description ?? wrapped.title ?? wrapped.note_title ?? row.title ?? row.desc);
  // Live weibo/xhs payloads embed light markup; plain text downstream.
  const content = rawContent?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined;
  const platform = nonempty(row.platform) ?? input.platform;
  if (!sourceId || !content || !platform || !platforms.includes(platform as SocialPlatform)) return null;
  const statistics = record(wrapped.statistics) ?? {};
  const rawMetrics = record(wrapped.metrics) ?? {
    likes: statistics.digg_count ?? statistics.like_count ?? wrapped.liked_count ?? wrapped.liked ?? wrapped.attitudes_count,
    comments: statistics.comment_count ?? wrapped.comments_count ?? wrapped.comment_count,
    shares: statistics.share_count ?? wrapped.shared_count ?? wrapped.reposts_count,
    views: statistics.play_count ?? statistics.view_count ?? wrapped.view_count ?? wrapped.read_count,
  };
  const metrics = Object.fromEntries(Object.entries(rawMetrics).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isFinite(entry[1]),
  ));
  const city = input.city ?? nonempty(row.city) ?? "";
  const sourceUrl = nonempty(wrapped.sourceUrl ?? wrapped.source_url ?? wrapped.share_url ?? wrapped.doc_url ?? wrapped.url ?? row.doc_url);
  return {
    provider, platform: platform as SocialPlatform, sourceId,
    ...(sourceUrl && /^https:\/\//i.test(sourceUrl) ? { sourceUrl } : {}),
    city,
    entityType: nonempty(row.entityType ?? row.entity_type),
    entityId: nonempty(row.entityId ?? row.entity_id),
    content, summary: nonempty(wrapped.summary),
    publishedAt: isoDate(wrapped.publishedAt ?? wrapped.published_at ?? wrapped.publish_time ?? wrapped.create_time ?? wrapped.created_at ?? wrapped.update_time ?? wrapped.timestamp ?? wrapped.time ?? wrapped.date),
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
  supportedOperations?: readonly SocialOperation[];
  now?: () => Date;
}): SocialProvider {
  const apiKey = input.apiKey?.trim() ?? "";
  const configured = Boolean(apiKey && input.transport);
  const now = input.now ?? (() => new Date());

  async function request(operation: SocialOperation, args: SocialSearchInput | SocialContentInput): Promise<SocialProviderResult<unknown>> {
    if (input.supportedOperations && !input.supportedOperations.includes(operation)) {
      return { status: "unavailable", data: null, warnings: [`${input.name} ${operation} is not enabled for this adapter`] };
    }
    if (!configured || !input.transport) return { status: "unavailable", data: null, warnings: [`${input.name} is not configured`] };
    if (args.platform && !input.platforms.includes(args.platform)) {
      return { status: "unavailable", data: null, warnings: [`${input.name} does not support ${args.platform}`] };
    }
    try {
      return { status: "ok", data: await input.transport({ provider: input.name, operation, apiKey, input: args }), warnings: [] };
    } catch (error) {
      if (error instanceof SocialProviderRequestError) {
        return { status: "error", data: null, warnings: [error.message] };
      }
      return { status: "error", data: null, warnings: [`${input.name} request failed`] };
    }
  }

  async function contentList(operation: "searchContent" | "getTrending", args: SocialSearchInput): Promise<SocialProviderResult<SocialObservation[]>> {
    const result = await request(operation, args);
    return { status: result.status, warnings: result.warnings,
      data: rows(result.data).flatMap((row) => {
        const item = normalizeObservation(row, input.name, input.platforms, args, now());
        return item ? [item] : [];
      }).slice(0, Math.max(0, Math.min(args.limit ?? 20, 20))),
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
