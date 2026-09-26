# Voyage Travel Knowledge

This directory contains versioned, reviewable knowledge sources for the Voyage RAG engine.

## Source format

Markdown and text files may use lightweight frontmatter:

```md
---
kind: city_rule
city: 重庆
title: 重庆山城地形规则
tags: [terrain, walking]
confidence: 0.95
source: voyage-curated
sourceUrl: https://example.com/source
authorityLevel: curated
validFrom: 2026-01-01T00:00:00Z
validTo: 2027-01-01T00:00:00Z
---

Knowledge body...
```

Supported `kind` values:

- `city_rule`
- `poi_knowledge`
- `transport_rule`
- `route_case`

Supported authority levels:

- `official`
- `curated`
- `community`
- `user`
- `derived`

JSON files are also supported with equivalent fields and a `content` property.

## Ingestion

Apply Supabase migrations first, then configure:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Optional semantic retrieval
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
EMBEDDING_DIMENSIONS=1536
```

Ingest changed documents:

```bash
npm run knowledge:ingest
```

Force re-chunking and re-embedding:

```bash
npm run knowledge:reindex
```

The ingestion pipeline normalizes text, hashes documents for deduplication, chunks content,
optionally creates embeddings, and writes documents/chunks to Supabase.

## Retrieval model

Voyage uses hybrid retrieval:

1. city / validity / confidence filtering
2. keyword retrieval
3. pgvector semantic retrieval when an embedding provider is configured
4. reciprocal-rank fusion
5. confidence, freshness, city, tag, and authority boosts
6. local curated fallback if the database or embedding service is unavailable

RAG knowledge is planning context, not live truth. Realtime route, weather, availability,
traffic, operating status, and price facts must come from live providers and take precedence.
