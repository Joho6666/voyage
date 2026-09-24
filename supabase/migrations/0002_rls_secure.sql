-- Voyage Phase 3: Secure Row Level Security (RLS) bound strictly to auth.uid()
-- Prevents cross-user trip leaks and enforces strict ownership.

-- 1. Drop wide-open Phase 1/2 policies
drop policy if exists "trips owner all" on trips;
drop policy if exists "trip_days owner all" on trip_days;
drop policy if exists "places owner all" on places;
drop policy if exists "itinerary_items owner all" on itinerary_items;
drop policy if exists "route_segments owner all" on route_segments;
drop policy if exists "budget_items owner all" on budget_items;
drop policy if exists "trip_tasks owner all" on trip_tasks;
drop policy if exists "bookings owner all" on bookings;

-- 2. Trips: owner-isolated access
create policy "trips_owner_select" on trips
  for select using (auth.uid() = owner_id);

create policy "trips_owner_insert" on trips
  for insert with check (auth.uid() = owner_id);

create policy "trips_owner_update" on trips
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "trips_owner_delete" on trips
  for delete using (auth.uid() = owner_id);

-- 3. Child tables: cascaded ownership via trips.owner_id = auth.uid()
create policy "trip_days_owner_access" on trip_days
  for all using (
    exists (select 1 from trips where trips.id = trip_days.trip_id and trips.owner_id = auth.uid())
  );

create policy "places_owner_access" on places
  for all using (
    exists (select 1 from trips where trips.id = places.trip_id and trips.owner_id = auth.uid())
  );

create policy "itinerary_items_owner_access" on itinerary_items
  for all using (
    exists (select 1 from trips where trips.id = itinerary_items.trip_id and trips.owner_id = auth.uid())
  );

create policy "route_segments_owner_access" on route_segments
  for all using (
    exists (select 1 from trips where trips.id = route_segments.trip_id and trips.owner_id = auth.uid())
  );

create policy "budget_items_owner_access" on budget_items
  for all using (
    exists (select 1 from trips where trips.id = budget_items.trip_id and trips.owner_id = auth.uid())
  );

create policy "trip_tasks_owner_access" on trip_tasks
  for all using (
    exists (select 1 from trips where trips.id = trip_tasks.trip_id and trips.owner_id = auth.uid())
  );

create policy "bookings_owner_access" on bookings
  for all using (
    exists (select 1 from trips where trips.id = bookings.trip_id and trips.owner_id = auth.uid())
  );
