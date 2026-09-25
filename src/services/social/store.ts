import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { LiveSocialSearchResult } from "./live-search";

/** Server-role persistence is optional so guest mode remains usable. */
export async function persistSocialSearch(result: LiveSocialSearchResult): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (result.observations.length) {
    const rows = result.observations.map((item) => ({
      query_id: result.queryId,
      content_fingerprint: createHash("sha256").update(item.content.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex"),
      provider: item.provider, platform: item.platform, source_id: item.sourceId,
      source_url: item.sourceUrl ?? null, city: item.city,
      entity_type: item.entityType ?? null, entity_id: item.entityId ?? null,
      content: item.content, summary: item.summary ?? null,
      published_at: item.publishedAt ?? null, fetched_at: item.fetchedAt,
      expires_at: item.expiresAt, metrics: item.metrics,
      raw_metadata: item.rawMetadata,
    }));
    const { error } = await client.from("social_observations").upsert(rows, { onConflict: "provider,platform,source_id" });
    if (error) throw new Error(`social_observations save failed: ${error.message}`);
  }
  if (result.signals.length) {
    const rows = result.signals.map((item) => ({
      id: item.id, query_id: result.queryId, city: item.city,
      entity_id: item.entityId ?? null, signal_type: item.signalType,
      value: item.value, confidence: item.confidence, sample_size: item.sampleSize,
      platform_count: item.platformCount, observed_at: item.observedAt,
      expires_at: item.expiresAt, sources: item.sources,
    }));
    const { error } = await client.from("social_signals").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`social_signals save failed: ${error.message}`);
  }
}
