# Voyage / Travel OS — Architecture

Product name is centralized in `src/lib/brand.ts`. Change `brand.name` once to rename the product.

## Boundary

Voyage is a sibling Next.js app at `voyage/`, port **3002**. It does not share runtime with C-Embedded Agent (`src/`, `:3000`) or UniGateway (`unigateway/`, `:3001`).

## Runtime

- Next.js 15 App Router, React 19, TypeScript strict
- Client state: Zustand (`ui-store`, selected POI / day / map)
- Server-shaped data: TanStack Query over `TripRepository`
- Forms: React Hook Form + Zod
- Motion: `motion` (150–250ms; spring for sheets / markers)

## Provider architecture

UI never imports AMap, OpenAI, or booking SDKs.

```
components  →  services/facades  →  adapters
```

### MapProvider

`src/services/map/types.ts`

- `MockMapProvider` — default. SVG / projected Chongqing canvas, numbered markers, day polylines, selection.
- `AMapProvider` — loaded only when `NEXT_PUBLIC_AMAP_KEY` is set.
- Reserved: `GoogleMapsProvider`, `MapboxProvider`.

### TravelAgent

`src/services/ai/types.ts`

- `MockTravelAgent` — staged generation + executable trip actions.
- `OpenAITravelAgent` — stub; public http(s) only, host must not be loopback / private.

Actions: `createTrip`, `optimizeDay`, `recommendPlaces`, `recommendFood`, `recommendActivities`, `reduceBudget`, `reduceWalking`, `moveItem`, `removeItem`, `addItem`.

### BookingProvider

`src/services/booking/types.ts`

- `MockBookingProvider` — outbound mock links.
- Reserved: Trip.com / Booking / Agoda.

### TripRepository

- `MemoryTripRepository` — demo Chongqing trip, default.
- `SupabaseTripRepository` — empty adapter; schema documented below.

## Data model

`Trip` owns `days[]`, `items[]`, `segments[]`, `places[]`, hotels, restaurants, activities, transports, tasks, budgetItems.

`ItineraryItem` points at `placeId`. Reordering recomputes `RouteSegment` via haversine + transit heuristic (walk / metro / taxi).

## Security (when remote I/O exists)

- Outbound URLs: http/https only. Validate host; reject localhost, loopback, private, and reserved addresses.
- SQL: parameterized queries only. Never concatenate user input into SQL.

## Supabase sketch (not required for MVP)

```
trips(id, title, destination, origin, start_date, end_date, travelers, budget, prompt, owner_id)
days(id, trip_id, index, date, title)
places(id, name, category, lat, lng, rating, image, address)
itinerary_items(id, day_id, type, place_id, start_time, duration, order, status)
route_segments(id, day_id, from_item_id, to_item_id, mode, meters, minutes)
tasks, budget_items, bookings
```

## Routes

| Path | Role |
|---|---|
| `/` | Landing |
| `/new-trip` | AI create |
| `/trips` | Trip list |
| `/trip/[id]` | Workspace (itinerary default) |
| `/trip/[id]/explore` `/food` `/hotels` `/activities` `/transport` `/tasks` `/budget` | Panels via layout |
| `/trip/[id]/today` | Travel mode |
| `/settings` | Settings |

## Folder map

```
voyage/src/
  app/
  components/{ui,travel,map,itinerary,ai,booking,layout}
  features/{trip-workspace,explore,today-mode,new-trip}
  hooks/ lib/ services/ store/ types/
  data/demo/chongqing.ts
```
