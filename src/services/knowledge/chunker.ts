import { createHash } from "node:crypto";
import type { KnowledgeChunk, KnowledgeSourceDocument } from "./types";

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
  minChars?: number;
}

export function normalizeKnowledgeText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function knowledgeContentHash(value: string) {
  return createHash("sha256").update(normalizeKnowledgeText(value)).digest("hex");
}

function splitSections(content: string) {
  const lines = normalizeKnowledgeText(content).split("\n");
  const sections: Array<{ heading?: string; body: string }> = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const body = normalizeKnowledgeText(buffer.join("\n"));
    if (body) sections.push({ heading, body });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (match) {
      flush();
      heading = match[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ body: normalizeKnowledgeText(content) }];
}

function splitParagraphs(value: string) {
  return normalizeKnowledgeText(value)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hardSlice(value: string, maxChars: number, overlapChars: number) {
  const out: string[] = [];
  let start = 0;
  while (start < value.length) {
    const end = Math.min(value.length, start + maxChars);
    out.push(value.slice(start, end).trim());
    if (end >= value.length) break;
    start = Math.max(start + 1, end - overlapChars);
  }
  return out.filter(Boolean);
}

export function chunkKnowledgeDocument(
  document: KnowledgeSourceDocument,
  options: ChunkOptions = {},
): KnowledgeChunk[] {
  const maxChars = Math.max(300, options.maxChars ?? 900);
  const overlapChars = Math.max(0, Math.min(maxChars / 2, options.overlapChars ?? 120));
  const minChars = Math.max(40, options.minChars ?? 120);
  const rawChunks: Array<{ heading?: string; content: string }> = [];

  for (const section of splitSections(document.content)) {
    const paragraphs = splitParagraphs(section.body);
    let buffer = "";

    const flush = () => {
      const content = normalizeKnowledgeText(buffer);
      if (content) rawChunks.push({ heading: section.heading, content });
      buffer = "";
    };

    for (const paragraph of paragraphs) {
      if (paragraph.length > maxChars) {
        flush();
        for (const slice of hardSlice(paragraph, maxChars, overlapChars)) {
          rawChunks.push({ heading: section.heading, content: slice });
        }
        continue;
      }

      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (next.length > maxChars) {
        flush();
        const previous = rawChunks.at(-1)?.content ?? "";
        const overlap = previous.slice(Math.max(0, previous.length - overlapChars));
        buffer = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
      } else {
        buffer = next;
      }
    }
    flush();
  }

  const merged = rawChunks.reduce<Array<{ heading?: string; content: string }>>((acc, chunk) => {
    if (chunk.content.length >= minChars || acc.length === 0) {
      acc.push(chunk);
      return acc;
    }
    const previous = acc[acc.length - 1];
    previous.content = normalizeKnowledgeText(`${previous.content}\n\n${chunk.content}`);
    return acc;
  }, []);

  return merged.map((chunk, chunkIndex) => {
    const title = chunk.heading ? `${document.title} · ${chunk.heading}` : document.title;
    const contentHash = knowledgeContentHash([
      document.sourceKey,
      String(chunkIndex),
      title,
      chunk.content,
    ].join("\n"));
    return {
      chunkIndex,
      title,
      content: chunk.content,
      tags: [...new Set(document.tags)],
      city: document.city,
      kind: document.kind,
      confidence: document.confidence,
      source: document.source,
      sourceUrl: document.sourceUrl,
      authorityLevel: document.authorityLevel,
      validFrom: document.validFrom,
      validTo: document.validTo,
      metadata: { ...document.metadata, sourceKey: document.sourceKey },
      contentHash,
    };
  });
}
