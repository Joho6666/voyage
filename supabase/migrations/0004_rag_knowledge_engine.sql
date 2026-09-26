-- Voyage RAG Knowledge Engine v1
-- Documents -> chunks -> hybrid keyword + semantic retrieval.
-- Live route/weather/price providers remain authoritative over RAG context.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  source_key text not null,
  kind text not null check (kind in ('city_rule', 'poi_knowledge', 'transport_rule', 'route_case')),
  city text not null default '*',
  title text not null,
  source text not null,
  source_url text,
  authority_level text not null default 'curated'
    check (authority_level in ('official', 'curated', 'community', 'user', 'derived')),
  confidence real not null default 0.8 check (confidence >= 0 and confidence <= 1),
  valid_from timestamptz,
  valid_to timestamptz,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (owner_id, source_key)
);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  kind text not null check (kind in ('city_rule', 'poi_knowledge', 'transport_rule', 'route_case')),
  city text not null default '*',
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  confidence real not null default 0.8 check (confidence >= 0 and confidence <= 1),
  source text not null,
  source_url text,
  authority_level text not null default 'curated'
    check (authority_level in ('official', 'curated', 'community', 'user', 'derived')),
  valid_from timestamptz,
  valid_to timestamptz,
  content_hash text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, chunk_index),
  unique(document_id, content_hash)
);

create index if not exists knowledge_documents_city_kind_idx
  on knowledge_documents (city, kind);

create index if not exists knowledge_chunks_city_kind_idx
  on knowledge_chunks (city, kind);

create index if not exists knowledge_chunks_tags_idx
  on knowledge_chunks using gin (tags);

create index if not exists knowledge_chunks_fts_idx
  on knowledge_chunks using gin (fts);

create index if not exists knowledge_chunks_embedding_hnsw_idx
  on knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;

drop policy if exists "knowledge_documents_read" on knowledge_documents;
drop policy if exists "knowledge_documents_owner_all" on knowledge_documents;
drop policy if exists "knowledge_chunks_read" on knowledge_chunks;
drop policy if exists "knowledge_chunks_owner_all" on knowledge_chunks;

create policy "knowledge_documents_read" on knowledge_documents
  for select using (owner_id is null or auth.uid() = owner_id);

create policy "knowledge_documents_owner_all" on knowledge_documents
  for all using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "knowledge_chunks_read" on knowledge_chunks
  for select using (
    exists (
      select 1
      from knowledge_documents d
      where d.id = knowledge_chunks.document_id
        and (d.owner_id is null or d.owner_id = auth.uid())
    )
  );

create policy "knowledge_chunks_owner_all" on knowledge_chunks
  for all using (
    exists (
      select 1
      from knowledge_documents d
      where d.id = knowledge_chunks.document_id
        and d.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from knowledge_documents d
      where d.id = knowledge_chunks.document_id
        and d.owner_id = auth.uid()
    )
  );

create or replace function hybrid_search_travel_knowledge(
  query_text text,
  query_embedding extensions.vector(1536),
  query_city text default '*',
  query_tags text[] default '{}',
  match_count int default 8,
  min_confidence real default 0.5,
  full_text_weight real default 1.0,
  semantic_weight real default 1.0,
  rrf_k int default 50
)
returns table (
  id uuid,
  document_id uuid,
  kind text,
  city text,
  title text,
  content text,
  tags text[],
  confidence real,
  source text,
  source_url text,
  authority_level text,
  valid_from timestamptz,
  valid_to timestamptz,
  updated_at timestamptz,
  metadata jsonb,
  keyword_score real,
  semantic_score real,
  freshness_score real,
  tag_score real,
  hybrid_score real
)
language sql
stable
set search_path = public, extensions
as $$
with eligible as (
  select kc.*
  from knowledge_chunks kc
  join knowledge_documents kd on kd.id = kc.document_id
  where kc.confidence >= min_confidence
    and (query_city = '*' or kc.city = query_city or kc.city = '*')
    and (kc.valid_from is null or kc.valid_from <= now())
    and (kc.valid_to is null or kc.valid_to >= now())
),
query_tokens as (
  select array_remove(regexp_split_to_array(lower(trim(coalesce(query_text, ''))), '\s+'), '') as tokens
),
keyword_candidates as (
  select
    e.id,
    greatest(
      case
        when trim(coalesce(query_text, '')) = '' then 0::real
        else ts_rank_cd(e.fts, websearch_to_tsquery('simple', query_text))
      end,
      (
        select coalesce(
          count(*)::real / nullif(cardinality(q.tokens), 0),
          0
        )
        from query_tokens q,
        unnest(q.tokens) token
        where lower(e.title || ' ' || e.content) like '%' || token || '%'
      )
    )::real as score
  from eligible e
),
keyword_ranked as (
  select
    id,
    score,
    row_number() over (order by score desc, id) as rank
  from keyword_candidates
  where score > 0
  order by score desc
  limit 60
),
semantic_ranked as (
  select
    e.id,
    (1 - (e.embedding <=> query_embedding))::real as score,
    row_number() over (order by e.embedding <=> query_embedding, e.id) as rank
  from eligible e
  where query_embedding is not null and e.embedding is not null
  order by e.embedding <=> query_embedding
  limit 60
),
combined as (
  select
    e.*,
    coalesce(kr.score, 0)::real as keyword_score,
    coalesce(sr.score, 0)::real as semantic_score,
    (
      1.0 / (
        1.0 + greatest(0, extract(epoch from (now() - e.updated_at)) / 86400.0) / 365.0
      )
    )::real as freshness_score,
    (
      select case
        when cardinality(query_tags) = 0 then 0
        else count(*)::real / cardinality(query_tags)
      end
      from unnest(query_tags) tag
      where tag = any(e.tags)
    )::real as tag_score,
    (
      case when kr.rank is null then 0 else full_text_weight / (rrf_k + kr.rank) end +
      case when sr.rank is null then 0 else semantic_weight / (rrf_k + sr.rank) end
    )::real as rrf_score
  from eligible e
  left join keyword_ranked kr on kr.id = e.id
  left join semantic_ranked sr on sr.id = e.id
  where kr.id is not null
     or sr.id is not null
     or (cardinality(query_tags) > 0 and e.tags && query_tags)
)
select
  c.id,
  c.document_id,
  c.kind,
  c.city,
  c.title,
  c.content,
  c.tags,
  c.confidence,
  c.source,
  c.source_url,
  c.authority_level,
  c.valid_from,
  c.valid_to,
  c.updated_at,
  c.metadata,
  c.keyword_score,
  c.semantic_score,
  c.freshness_score,
  c.tag_score,
  (
    c.rrf_score
    + c.confidence * 0.010
    + c.freshness_score * 0.004
    + c.tag_score * 0.006
    + case when c.city = query_city then 0.004 else 0 end
    + case c.authority_level
        when 'official' then 0.004
        when 'curated' then 0.003
        when 'derived' then 0.002
        when 'community' then 0.001
        else 0
      end
  )::real as hybrid_score
from combined c
order by hybrid_score desc, c.confidence desc
limit greatest(1, least(match_count, 50));
$$;

comment on function hybrid_search_travel_knowledge is
  'Hybrid RRF retrieval over keyword + pgvector semantic search with confidence, freshness, city, tag and authority boosts.';
