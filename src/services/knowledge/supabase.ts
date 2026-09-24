import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runtimeConfigSync } from "@/services/config/local-credentials";
import type { KnowledgeChunk, KnowledgeSourceDocument } from "./types";

function supabaseUrl() {
  return runtimeConfigSync("NEXT_PUBLIC_SUPABASE_URL");
}

function supabaseAnonKey() {
  return runtimeConfigSync("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function supabaseServiceRoleKey() {
  return runtimeConfigSync("SUPABASE_SERVICE_ROLE_KEY");
}

export function createKnowledgeReadClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createKnowledgeAdminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseKnowledgeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findDocumentBySourceKey(sourceKey: string) {
    const { data, error } = await this.client
      .from("knowledge_documents")
      .select("id,source_key,content_hash,updated_at")
      .eq("source_key", sourceKey)
      .maybeSingle();
    if (error) throw new Error(`knowledge document lookup failed: ${error.message}`);
    return data as { id: string; source_key: string; content_hash: string; updated_at: string } | null;
  }

  async upsertDocument(
    document: KnowledgeSourceDocument,
    contentHash: string,
    ownerId: string | null = null,
  ) {
    const row = {
      owner_id: ownerId,
      source_key: document.sourceKey,
      kind: document.kind,
      city: document.city,
      title: document.title,
      source: document.source,
      source_url: document.sourceUrl ?? null,
      authority_level: document.authorityLevel,
      confidence: document.confidence,
      valid_from: document.validFrom ?? null,
      valid_to: document.validTo ?? null,
      content_hash: contentHash,
      metadata: document.metadata,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.client
      .from("knowledge_documents")
      .upsert(row, { onConflict: "source_key" })
      .select("id")
      .single();
    if (error) throw new Error(`knowledge document upsert failed: ${error.message}`);
    return data.id as string;
  }

  async replaceChunks(documentId: string, chunks: KnowledgeChunk[]) {
    const deleted = await this.client.from("knowledge_chunks").delete().eq("document_id", documentId);
    if (deleted.error) throw new Error(`knowledge chunk delete failed: ${deleted.error.message}`);

    if (!chunks.length) return;
    const rows = chunks.map((chunk) => ({
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      kind: chunk.kind,
      city: chunk.city,
      title: chunk.title,
      content: chunk.content,
      tags: chunk.tags,
      confidence: chunk.confidence,
      source: chunk.source,
      source_url: chunk.sourceUrl ?? null,
      authority_level: chunk.authorityLevel,
      valid_from: chunk.validFrom ?? null,
      valid_to: chunk.validTo ?? null,
      content_hash: chunk.contentHash,
      embedding: chunk.embedding ?? null,
      metadata: chunk.metadata,
      updated_at: new Date().toISOString(),
    }));

    for (let index = 0; index < rows.length; index += 100) {
      const { error } = await this.client
        .from("knowledge_chunks")
        .insert(rows.slice(index, index + 100));
      if (error) throw new Error(`knowledge chunk insert failed: ${error.message}`);
    }
  }
}
