import { assertPublicHttpUrl } from "@/lib/safe-url";
import { runtimeConfigSync } from "@/services/config/local-credentials";

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
}

export function embeddingConfig() {
  const baseUrl = runtimeConfigSync("EMBEDDING_BASE_URL");
  const model = runtimeConfigSync("EMBEDDING_MODEL");
  const apiKey = runtimeConfigSync("EMBEDDING_API_KEY");
  const dimensions = Number(runtimeConfigSync("EMBEDDING_DIMENSIONS") || "1536");
  if (!baseUrl || !model) return null;
  if (dimensions !== 1536) {
    throw new Error("Voyage RAG v1 currently requires EMBEDDING_DIMENSIONS=1536 to match the pgvector schema");
  }
  return { baseUrl, model, apiKey, dimensions };
}

function endpointFromBase(baseUrl: string) {
  const base = assertPublicHttpUrl(baseUrl);
  const normalized = new URL(base.toString().endsWith("/") ? base.toString() : base.toString() + "/");
  return new URL("embeddings", normalized);
}

export function createEmbeddingProvider(): EmbeddingProvider | null {
  const config = embeddingConfig();
  if (!config) return null;

  return {
    id: `openai-compatible:${config.model}`,
    dimensions: config.dimensions,
    async embed(texts: string[]) {
      if (!texts.length) return [];
      const response = await fetch(endpointFromBase(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
        }),
      });

      const payload = await response.json().catch(() => ({})) as EmbeddingResponse;
      if (!response.ok) {
        throw new Error(
          `Embedding request failed (${response.status}): ${payload.error?.message ?? "unknown error"}`,
        );
      }

      const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (rows.length !== texts.length) {
        throw new Error(`Embedding provider returned ${rows.length} vectors for ${texts.length} inputs`);
      }

      return rows.map((row, index) => {
        const embedding = row.embedding;
        if (!Array.isArray(embedding) || embedding.length !== config.dimensions) {
          throw new Error(
            `Embedding vector ${index} has ${Array.isArray(embedding) ? embedding.length : 0} dimensions; expected ${config.dimensions}`,
          );
        }
        if (embedding.some((value) => !Number.isFinite(value))) {
          throw new Error(`Embedding vector ${index} contains non-finite values`);
        }
        return embedding;
      });
    },
  };
}

export async function embedInBatches(
  provider: EmbeddingProvider,
  texts: string[],
  batchSize = 32,
) {
  const vectors: number[][] = [];
  for (let index = 0; index < texts.length; index += batchSize) {
    vectors.push(...await provider.embed(texts.slice(index, index + batchSize)));
  }
  return vectors;
}
