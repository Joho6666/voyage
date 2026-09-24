import { createEmbeddingProvider } from "./embeddings";
import { retrieveTravelKnowledge } from "./retriever";
import { createKnowledgeReadClient } from "./supabase";
import type {
  KnowledgeAuthorityLevel,
  KnowledgeRetrievalResult,
  TravelKnowledgeKind,
  TravelKnowledgeMatch,
} from "./types";

interface HybridRow {
  id: string;
  document_id: string;
  kind: TravelKnowledgeKind;
  city: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  source: string;
  source_url?: string | null;
  authority_level: KnowledgeAuthorityLevel;
  valid_from?: string | null;
  valid_to?: string | null;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
  keyword_score?: number | null;
  semantic_score?: number | null;
  freshness_score?: number | null;
  tag_score?: number | null;
  hybrid_score: number;
}

export interface HybridRetrieveInput {
  city: string;
  query: string;
  tags?: string[];
  limit?: number;
  minConfidence?: number;
}

function localFallback(input: HybridRetrieveInput, warnings: string[] = []): KnowledgeRetrievalResult {
  return {
    matches: retrieveTravelKnowledge({
      city: input.city,
      query: input.query,
      tags: input.tags,
      limit: input.limit,
    }),
    strategy: "curated-local",
    vectorUsed: false,
    databaseUsed: false,
    warnings,
  };
}

function normalizeRows(rows: HybridRow[], limit: number): TravelKnowledgeMatch[] {
  const max = Math.max(...rows.map((row) => Number(row.hybrid_score) || 0), 0.000001);
  return rows.slice(0, limit).map((row) => {
    const hybrid = Number(row.hybrid_score) || 0;
    return {
      id: row.id,
      documentId: row.document_id,
      chunkId: row.id,
      kind: row.kind,
      city: row.city,
      title: row.title,
      content: row.content,
      tags: row.tags ?? [],
      confidence: Number(row.confidence),
      source: row.source,
      sourceUrl: row.source_url ?? undefined,
      authorityLevel: row.authority_level,
      validFrom: row.valid_from ?? undefined,
      validTo: row.valid_to ?? undefined,
      updatedAt: row.updated_at,
      metadata: row.metadata ?? {},
      relevance: Math.max(0, Math.min(1, hybrid / max)),
      score: {
        hybrid,
        semantic: Number(row.semantic_score) || 0,
        keyword: Number(row.keyword_score) || 0,
        freshness: Number(row.freshness_score) || 0,
        confidence: Number(row.confidence) || 0,
        tag: Number(row.tag_score) || 0,
        city: row.city === "*" ? 0 : 1,
      },
      citation: {
        title: row.title,
        source: row.source,
        sourceUrl: row.source_url ?? undefined,
        updatedAt: row.updated_at,
      },
    };
  });
}

export async function retrieveTravelKnowledgeHybrid(
  input: HybridRetrieveInput,
): Promise<KnowledgeRetrievalResult> {
  const limit = Math.max(1, Math.min(20, input.limit ?? 8));
  const client = createKnowledgeReadClient();
  if (!client) return localFallback(input, ["Supabase knowledge database is not configured"]);

  const warnings: string[] = [];
  let embedding: number[] | null = null;
  let vectorUsed = false;
  const provider = createEmbeddingProvider();

  if (provider) {
    try {
      [embedding] = await provider.embed([input.query]);
      vectorUsed = true;
    } catch (error) {
      warnings.push(
        `Semantic embedding unavailable; keyword retrieval used: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  } else {
    warnings.push("Embedding provider is not configured; keyword retrieval used");
  }

  const { data, error } = await client.rpc("hybrid_search_travel_knowledge", {
    query_text: input.query,
    query_embedding: embedding,
    query_city: input.city,
    query_tags: input.tags ?? [],
    match_count: Math.max(limit, Math.min(40, limit * 3)),
    min_confidence: input.minConfidence ?? 0.5,
    full_text_weight: 1,
    semantic_weight: vectorUsed ? 1 : 0,
    rrf_k: 50,
  });

  if (error) {
    return localFallback(input, [
      ...warnings,
      `Supabase hybrid retrieval unavailable; curated fallback used: ${error.message}`,
    ]);
  }

  const rows = (data ?? []) as HybridRow[];
  if (!rows.length) {
    return localFallback(input, [
      ...warnings,
      "Knowledge database returned no matches; curated fallback used",
    ]);
  }

  const matches = normalizeRows(rows, limit);
  const semanticPresent = vectorUsed && matches.some((match) => (match.score?.semantic ?? 0) > 0);
  return {
    matches,
    strategy: semanticPresent ? "hybrid" : "keyword",
    vectorUsed: semanticPresent,
    databaseUsed: true,
    warnings,
  };
}
