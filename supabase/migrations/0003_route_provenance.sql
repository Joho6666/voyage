-- Preserve authoritative route provenance in the normalized query surface.
-- trips.id remains text so existing demo IDs keep working; production IDs are UUID strings.
alter table route_segments add column if not exists provider text not null default 'haversine';
alter table route_segments add column if not exists estimated boolean not null default true;
alter table route_segments add column if not exists provider_route_id text;
alter table route_segments add column if not exists steps jsonb;
