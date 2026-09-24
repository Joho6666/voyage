import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { chunkKnowledgeDocument, knowledgeContentHash, normalizeKnowledgeText } from "./chunker";
import { createEmbeddingProvider, embedInBatches, type EmbeddingProvider } from "./embeddings";
import { createKnowledgeAdminClient, SupabaseKnowledgeRepository } from "./supabase";
import type {
  KnowledgeAuthorityLevel,
  KnowledgeSourceDocument,
  TravelKnowledgeKind,
} from "./types";

const KINDS = new Set<TravelKnowledgeKind>([
  "city_rule",
  "poi_knowledge",
  "transport_rule",
  "route_case",
]);
const AUTHORITIES = new Set<KnowledgeAuthorityLevel>([
  "official",
  "curated",
  "community",
  "user",
  "derived",
]);

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(raw: string) {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { attributes: {} as Record<string, unknown>, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { attributes: {} as Record<string, unknown>, body: normalized };
  const header = normalized.slice(4, end);
  const attributes: Record<string, unknown> = {};
  for (const line of header.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    attributes[match[1]] = parseScalar(match[2]);
  }
  return { attributes, body: normalized.slice(end + 5) };
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function numberBetween(value: unknown, fallback: number, min = 0, max = 1) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function inferKind(value: unknown): TravelKnowledgeKind {
  return typeof value === "string" && KINDS.has(value as TravelKnowledgeKind)
    ? value as TravelKnowledgeKind
    : "city_rule";
}

function inferAuthority(value: unknown): KnowledgeAuthorityLevel {
  return typeof value === "string" && AUTHORITIES.has(value as KnowledgeAuthorityLevel)
    ? value as KnowledgeAuthorityLevel
    : "curated";
}

function toSourceKey(file: string, root: string) {
  return path.relative(root, file).split(path.sep).join("/");
}

export async function parseKnowledgeFile(file: string, root: string): Promise<KnowledgeSourceDocument> {
  const raw = await readFile(file, "utf8");
  const extension = path.extname(file).toLowerCase();

  if (extension === ".json") {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const content = normalizeKnowledgeText(String(parsed.content ?? ""));
    if (!content) throw new Error(`Knowledge JSON has no content: ${file}`);
    return {
      sourceKey: String(parsed.sourceKey ?? toSourceKey(file, root)),
      kind: inferKind(parsed.kind),
      city: String(parsed.city ?? "*"),
      title: String(parsed.title ?? path.basename(file, extension)),
      content,
      tags: stringArray(parsed.tags),
      confidence: numberBetween(parsed.confidence, 0.8),
      source: String(parsed.source ?? "local"),
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : undefined,
      authorityLevel: inferAuthority(parsed.authorityLevel),
      validFrom: typeof parsed.validFrom === "string" ? parsed.validFrom : undefined,
      validTo: typeof parsed.validTo === "string" ? parsed.validTo : undefined,
      metadata: typeof parsed.metadata === "object" && parsed.metadata !== null
        ? parsed.metadata as Record<string, unknown>
        : {},
    };
  }

  const { attributes, body } = parseFrontmatter(raw);
  const content = normalizeKnowledgeText(body);
  if (!content) throw new Error(`Knowledge file has no content: ${file}`);
  return {
    sourceKey: String(attributes.sourceKey ?? toSourceKey(file, root)),
    kind: inferKind(attributes.kind),
    city: String(attributes.city ?? "*"),
    title: String(attributes.title ?? path.basename(file, extension)),
    content,
    tags: stringArray(attributes.tags),
    confidence: numberBetween(attributes.confidence, 0.8),
    source: String(attributes.source ?? "local"),
    sourceUrl: typeof attributes.sourceUrl === "string" ? attributes.sourceUrl : undefined,
    authorityLevel: inferAuthority(attributes.authorityLevel),
    validFrom: typeof attributes.validFrom === "string" ? attributes.validFrom : undefined,
    validTo: typeof attributes.validTo === "string" ? attributes.validTo : undefined,
    metadata: {},
  };
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  }));
  return nested.flat();
}

export async function discoverKnowledgeFiles(root: string) {
  return (await walk(root))
    .filter((file) => [".md", ".txt", ".json"].includes(path.extname(file).toLowerCase()))
    .filter((file) => !["readme.md", "readme.txt"].includes(path.basename(file).toLowerCase()))
    .filter((file) => !path.basename(file).startsWith("_"))
    .sort();
}

export interface IngestKnowledgeOptions {
  root: string;
  force?: boolean;
  ownerId?: string | null;
  embeddingProvider?: EmbeddingProvider | null;
}

export interface IngestKnowledgeSummary {
  documentsSeen: number;
  documentsWritten: number;
  documentsSkipped: number;
  chunksWritten: number;
  embeddingsWritten: number;
  vectorEnabled: boolean;
  files: Array<{
    sourceKey: string;
    status: "written" | "skipped";
    chunks: number;
    embedded: number;
  }>;
}

export async function ingestKnowledgeDirectory(
  options: IngestKnowledgeOptions,
): Promise<IngestKnowledgeSummary> {
  const client = createKnowledgeAdminClient();
  if (!client) {
    throw new Error(
      "Knowledge ingestion requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const repository = new SupabaseKnowledgeRepository(client);
  const provider = options.embeddingProvider === undefined
    ? createEmbeddingProvider()
    : options.embeddingProvider;
  const files = await discoverKnowledgeFiles(options.root);
  const summary: IngestKnowledgeSummary = {
    documentsSeen: files.length,
    documentsWritten: 0,
    documentsSkipped: 0,
    chunksWritten: 0,
    embeddingsWritten: 0,
    vectorEnabled: Boolean(provider),
    files: [],
  };

  for (const file of files) {
    const document = await parseKnowledgeFile(file, options.root);
    const contentHash = knowledgeContentHash([
      document.kind,
      document.city,
      document.title,
      document.content,
      JSON.stringify(document.tags),
      String(document.confidence),
      document.source,
      document.sourceUrl ?? "",
      document.authorityLevel,
      document.validFrom ?? "",
      document.validTo ?? "",
    ].join("\n"));

    const existing = await repository.findDocumentBySourceKey(document.sourceKey);
    if (!options.force && existing?.content_hash === contentHash) {
      summary.documentsSkipped += 1;
      summary.files.push({ sourceKey: document.sourceKey, status: "skipped", chunks: 0, embedded: 0 });
      continue;
    }

    const chunks = chunkKnowledgeDocument(document);
    if (provider) {
      const vectors = await embedInBatches(provider, chunks.map((chunk) =>
        [chunk.title, chunk.city, chunk.tags.join(" "), chunk.content].filter(Boolean).join("\n"),
      ));
      chunks.forEach((chunk, index) => {
        chunk.embedding = vectors[index];
      });
    }

    const documentId = await repository.upsertDocument(
      document,
      contentHash,
      options.ownerId ?? null,
    );
    chunks.forEach((chunk) => { chunk.documentId = documentId; });
    await repository.replaceChunks(documentId, chunks);

    summary.documentsWritten += 1;
    summary.chunksWritten += chunks.length;
    summary.embeddingsWritten += provider ? chunks.length : 0;
    summary.files.push({
      sourceKey: document.sourceKey,
      status: "written",
      chunks: chunks.length,
      embedded: provider ? chunks.length : 0,
    });
  }

  return summary;
}
