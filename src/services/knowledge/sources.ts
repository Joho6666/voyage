import type { KnowledgeAuthorityLevel, TravelKnowledgeKind, TravelKnowledgeRecord } from "./types";

/**
 * Standard ingestion interface for knowledge pipelines. A pipeline turns any
 * source into a TravelKnowledgeRecord through `toKnowledgeDocument`; authority
 * and freshness are clamped per source class so low-trust content (especially
 * social-derived) can never enter the store as permanent high-authority
 * knowledge.
 */

export interface KnowledgeSourceBase {
  /** Stable identifier of the upstream source (file key, feed id, query id…). */
  readonly sourceKey: string;
  /** Human-readable origin label stored on the record. */
  readonly source: string;
  readonly sourceUrl?: string;
  readonly fetchedAt: string;
}

export interface OfficialSource extends KnowledgeSourceBase {
  readonly origin: "official";
}

export interface ManualCuratedSource extends KnowledgeSourceBase {
  readonly origin: "manual_curated";
}

export interface SocialDerivedSource extends KnowledgeSourceBase {
  readonly origin: "social_derived";
  /** Social content expires quickly; callers should pass the observation window end. */
  readonly observedUntil: string;
}

export interface ProviderDerivedSource extends KnowledgeSourceBase {
  readonly origin: "provider_derived";
}

export type KnowledgeSource =
  | OfficialSource
  | ManualCuratedSource
  | SocialDerivedSource
  | ProviderDerivedSource;

const MAX_AUTHORITY: Record<KnowledgeSource["origin"], KnowledgeAuthorityLevel> = {
  official: "official",
  manual_curated: "curated",
  provider_derived: "derived",
  social_derived: "social",
};

const SOCIAL_MAX_CONFIDENCE = 0.6;
const SOCIAL_MAX_TTL_DAYS = 7;

export interface KnowledgeDocumentInput {
  id: string;
  kind: TravelKnowledgeKind;
  city: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function toKnowledgeDocument(source: KnowledgeSource, input: KnowledgeDocumentInput, requestedAuthority?: KnowledgeAuthorityLevel): TravelKnowledgeRecord {
  const ceiling = MAX_AUTHORITY[source.origin];
  const authority: KnowledgeAuthorityLevel = requestedAuthority && authorityRank(requestedAuthority) <= authorityRank(ceiling) ? requestedAuthority : ceiling;
  const confidence = clamp(input.confidence, 0, source.origin === "social_derived" ? SOCIAL_MAX_CONFIDENCE : 1);

  const record: TravelKnowledgeRecord = {
    id: input.id,
    kind: input.kind,
    city: input.city,
    title: input.title,
    content: input.content,
    tags: input.tags,
    confidence,
    source: source.source,
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    authorityLevel: authority,
    updatedAt: source.fetchedAt,
  };

  if (source.origin === "social_derived") {
    const requestedTtlDays = (Date.parse(source.observedUntil) - Date.parse(source.fetchedAt)) / 86_400_000;
    const ttlDays = Number.isFinite(requestedTtlDays) ? Math.min(requestedTtlDays, SOCIAL_MAX_TTL_DAYS) : SOCIAL_MAX_TTL_DAYS;
    record.validFrom = source.fetchedAt;
    record.validTo = new Date(Date.parse(source.fetchedAt) + Math.max(ttlDays, 0) * 86_400_000).toISOString();
  }

  return record;
}

function authorityRank(level: KnowledgeAuthorityLevel): number {
  const order: KnowledgeAuthorityLevel[] = ["unknown", "social", "community", "user", "derived", "curated", "official"];
  return order.indexOf(level);
}

export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  if (!value || typeof value !== "object") return false;
  const origin = (value as { origin?: unknown }).origin;
  return origin === "official" || origin === "manual_curated" || origin === "social_derived" || origin === "provider_derived";
}
