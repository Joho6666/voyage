-- Associate short-lived social evidence with a live trip query.
alter table social_observations add column if not exists query_id text;
alter table social_observations add column if not exists content_fingerprint text;
alter table social_signals add column if not exists query_id text;
create index if not exists social_observations_query_idx on social_observations (query_id, expires_at);
create index if not exists social_observations_fingerprint_idx on social_observations (content_fingerprint);
create index if not exists social_signals_query_idx on social_signals (query_id, expires_at);
