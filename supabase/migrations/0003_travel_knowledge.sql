-- Voyage Transport Intelligence v2
-- Knowledge base foundation for curated city rules, POI knowledge,
-- transport rules and route cases. Live provider facts remain authoritative.

create extension if not exists vector;

create table if not exists travel_knowledge (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('city_rule', 'poi_knowledge', 'transport_rule', 'route_case')),
  city text not null default '*',
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  confidence real not null default 0.8 check (confidence >= 0 and confidence <= 1),
  source text not null,
  source_url text,
  valid_from timestamptz,
  valid_to timestamptz,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travel_knowledge_city_kind_idx
  on travel_knowledge (city, kind);

create index if not exists travel_knowledge_tags_idx
  on travel_knowledge using gin (tags);

create index if not exists travel_knowledge_embedding_idx
  on travel_knowledge using hnsw (embedding vector_cosine_ops);

alter table travel_knowledge enable row level security;

drop policy if exists "travel_knowledge_public_read" on travel_knowledge;
drop policy if exists "travel_knowledge_owner_all" on travel_knowledge;

-- Global curated records have owner_id = null and are readable by everyone.
-- User/private records remain isolated to their owner.
create policy "travel_knowledge_public_read" on travel_knowledge
  for select using (owner_id is null or auth.uid() = owner_id);

create policy "travel_knowledge_owner_all" on travel_knowledge
  for all using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function match_travel_knowledge(
  query_embedding vector(1536),
  query_city text,
  match_count int default 8,
  min_confidence real default 0.5
)
returns table (
  id uuid,
  kind text,
  city text,
  title text,
  content text,
  tags text[],
  confidence real,
  source text,
  source_url text,
  similarity float
)
language sql
stable
as $$
  select
    tk.id,
    tk.kind,
    tk.city,
    tk.title,
    tk.content,
    tk.tags,
    tk.confidence,
    tk.source,
    tk.source_url,
    1 - (tk.embedding <=> query_embedding) as similarity
  from travel_knowledge tk
  where
    tk.embedding is not null
    and tk.confidence >= min_confidence
    and (tk.city = query_city or tk.city = '*')
    and (tk.valid_from is null or tk.valid_from <= now())
    and (tk.valid_to is null or tk.valid_to >= now())
    and (tk.owner_id is null or tk.owner_id = auth.uid())
  order by tk.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;
