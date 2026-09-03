-- Voyage Phase 2 schema. All user-owned rows carry owner_id with RLS enabled.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists trips (
  id text primary key,
  owner_id uuid not null default auth.uid(),
  title text not null,
  destination text not null,
  origin text not null default '',
  start_date date not null,
  end_date date not null,
  travelers int not null default 1,
  budget numeric not null default 0,
  currency text not null default 'CNY',
  status text not null default 'draft',
  prompt text not null default '',
  cover_image text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trips_owner_idx on trips (owner_id, updated_at desc);

create table if not exists trip_days (
  id text primary key,
  trip_id text not null references trips(id) on delete cascade,
  idx int not null,
  date date not null,
  title text not null default ''
);
create index if not exists trip_days_trip_idx on trip_days (trip_id, idx);

create table if not exists places (
  id text not null,
  trip_id text not null references trips(id) on delete cascade,
  name text not null,
  category text not null,
  lat double precision not null,
  lng double precision not null,
  rating numeric not null default 0,
  address text not null default '',
  source text not null default 'demo',
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  primary key (trip_id, id)
);
create index if not exists places_trip_idx on places (trip_id);
create index if not exists places_geo_idx on places (lat, lng);

create table if not exists itinerary_items (
  id text not null,
  trip_id text not null references trips(id) on delete cascade,
  day_id text not null references trip_days(id) on delete cascade,
  place_id text not null,
  type text not null default 'place',
  start_time text not null default '09:00',
  end_time text,
  duration_minutes int not null default 60,
  order_idx int not null default 0,
  status text not null default 'planned',
  note text,
  reservation_id text,
  primary key (trip_id, id)
);
create index if not exists itinerary_items_trip_day_idx on itinerary_items (trip_id, day_id, order_idx);

create table if not exists route_segments (
  id text not null,
  trip_id text not null references trips(id) on delete cascade,
  day_id text not null,
  from_item_id text not null,
  to_item_id text not null,
  mode text not null,
  distance_meters numeric not null default 0,
  duration_minutes int not null default 0,
  polyline jsonb,
  estimated_cost numeric,
  primary key (trip_id, id)
);
create index if not exists route_segments_trip_idx on route_segments (trip_id, day_id);

create table if not exists budget_items (
  id text not null,
  trip_id text not null references trips(id) on delete cascade,
  category text not null,
  label text not null,
  amount numeric not null default 0,
  currency text not null default 'CNY',
  primary key (trip_id, id)
);

create table if not exists trip_tasks (
  id text not null,
  trip_id text not null references trips(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  due_at timestamptz,
  linked_item_id text,
  day_id text,
  payload jsonb not null default '{}'::jsonb,
  primary key (trip_id, id)
);

create table if not exists bookings (
  id text primary key,
  trip_id text not null references trips(id) on delete cascade,
  provider text not null,
  type text not null,
  status text not null default 'idle',
  external_url text,
  reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bookings_trip_idx on bookings (trip_id);

-- RLS: owner-only access. MVP runs with anon demo user; policies are permissive
-- for anon on purpose until real auth lands (see README security notes).
alter table trips enable row level security;
alter table trip_days enable row level security;
alter table places enable row level security;
alter table itinerary_items enable row level security;
alter table route_segments enable row level security;
alter table budget_items enable row level security;
alter table trip_tasks enable row level security;
alter table bookings enable row level security;

create policy "trips owner all" on trips for all using (true) with check (true);
create policy "trip_days owner all" on trip_days for all using (true) with check (true);
create policy "places owner all" on places for all using (true) with check (true);
create policy "itinerary_items owner all" on itinerary_items for all using (true) with check (true);
create policy "route_segments owner all" on route_segments for all using (true) with check (true);
create policy "budget_items owner all" on budget_items for all using (true) with check (true);
create policy "trip_tasks owner all" on trip_tasks for all using (true) with check (true);
create policy "bookings owner all" on bookings for all using (true) with check (true);
