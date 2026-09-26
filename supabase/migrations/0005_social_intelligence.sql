-- Short-lived social evidence is kept separate from long-lived RAG knowledge.
create table if not exists social_observations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('tikhub', 'redfox')),
  platform text not null,
  source_id text not null,
  source_url text,
  city text not null,
  entity_type text,
  entity_id text,
  content text not null,
  summary text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  unique (provider, platform, source_id),
  check (expires_at > fetched_at)
);

create index if not exists social_observations_city_entity_expiry_idx
  on social_observations (city, entity_id, expires_at);
create index if not exists social_observations_expiry_idx
  on social_observations (expires_at);

create table if not exists social_signals (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  entity_id text,
  signal_type text not null check (signal_type in (
    'crowd_risk', 'popular_time', 'travel_warning', 'trend_score', 'price_signal'
  )),
  value jsonb not null,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  sample_size integer not null check (sample_size > 0),
  platform_count integer not null check (platform_count > 0 and platform_count <= sample_size),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at > observed_at)
);

create or replace function set_social_signal_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.expires_at is null then
    new.expires_at := new.observed_at + case
      when new.signal_type = 'popular_time' then interval '7 days'
      else interval '24 hours'
    end;
  end if;
  return new;
end;
$$;

create trigger social_signals_default_expiry
  before insert on social_signals
  for each row execute function set_social_signal_expiry();

create index if not exists social_signals_city_entity_type_expiry_idx
  on social_signals (city, entity_id, signal_type, expires_at);
create index if not exists social_signals_expiry_idx
  on social_signals (expires_at);

alter table social_observations enable row level security;
alter table social_signals enable row level security;

-- No anon/authenticated policies: only the server's service role may read or write.
revoke all on social_observations, social_signals from anon, authenticated;
grant all on social_observations, social_signals to service_role;
