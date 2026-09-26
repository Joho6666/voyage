// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkKnowledgeDocument } from "@/services/knowledge/chunker";
import { parseKnowledgeFile } from "@/services/knowledge/ingest";
import { retrieveTravelKnowledgeHybrid } from "@/services/knowledge/hybrid-retriever";
import { buildTransportKnowledgeContext } from "@/services/knowledge/context-builder";
import type { KnowledgeSourceDocument } from "@/services/knowledge/types";

const previousEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // These tests deliberately exercise the unconfigured/curated fallback paths.
  delete process.env.VOYAGE_SKIP_LOCAL_CREDENTIALS;
});

describe("Travel Knowledge RAG", () => {
  beforeEach(() => {
    // Ignore the developer machine's real credentials for the whole describe.
    process.env.VOYAGE_SKIP_LOCAL_CREDENTIALS = "1";
  });

  it("chunks long knowledge documents while preserving metadata", () => {
    const document: KnowledgeSourceDocument = {
      sourceKey: "test/cq.md",
      kind: "city_rule",
      city: "重庆",
      title: "重庆步行规则",
      content: [
        "# 地形",
        "重庆山城存在明显高差。".repeat(35),
        "",
        "# 行李",
        "携带行李时减少复杂换乘。".repeat(35),
      ].join("\n"),
      tags: ["terrain", "walking"],
      confidence: 0.93,
      source: "test",
      authorityLevel: "curated",
      metadata: { fixture: true },
    };

    const chunks = chunkKnowledgeDocument(document, { maxChars: 420, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].city).toBe("重庆");
    expect(chunks[0].tags).toContain("terrain");
    expect(chunks.every((chunk) => chunk.contentHash.length === 64)).toBe(true);
    expect(chunks.some((chunk) => chunk.title.includes("地形"))).toBe(true);
  });

  it("parses markdown frontmatter into an ingestible document", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voyage-rag-"));
    try {
      const file = path.join(dir, "rule.md");
      await writeFile(file, `---
kind: transport_rule
city: 重庆
title: 雨天路线
tags: [rain, walking]
confidence: 0.94
source: fixture
authorityLevel: official
---

雨天应降低长距离露天步行权重。
`, "utf8");
      const parsed = await parseKnowledgeFile(file, dir);
      expect(parsed.kind).toBe("transport_rule");
      expect(parsed.city).toBe("重庆");
      expect(parsed.tags).toEqual(["rain", "walking"]);
      expect(parsed.authorityLevel).toBe("official");
      expect(parsed.content).toContain("露天步行");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to curated local retrieval when Supabase is unavailable", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;

    const result = await retrieveTravelKnowledgeHybrid({
      city: "重庆",
      query: "洪崖洞 夜景 人流 步行",
      tags: ["walking"],
      limit: 5,
    });

    expect(result.databaseUsed).toBe(false);
    expect(result.vectorUsed).toBe(false);
    expect(result.strategy).toBe("curated-local");
    expect(result.matches.some((item) => item.title.includes("洪崖洞") || item.title.includes("山城"))).toBe(true);
  });

  it("uses knowledge evidence to reduce walking tolerance in difficult contexts", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;

    const context = await buildTransportKnowledgeContext({
      city: "重庆",
      context: {
        fatigue: "high",
        weather: "rain",
        travelers: 2,
      },
      userQuery: "洪崖洞 晚上怎么走",
    });

    expect(context.evidence.length).toBeGreaterThan(0);
    expect(context.effectiveTransportContext.walkingTolerance).toBe("low");
    expect(context.retrieval.strategy).toBe("curated-local");
  });
});
