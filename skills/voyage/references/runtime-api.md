# Runtime API

Invoke with `node skills/voyage/scripts/voyage.mjs <command> --input request.json` or pass `--input -` and write JSON on stdin.

Commands:

- `create-trip`: `{origin, destination, startDate, endDate|days, people, budget, preferences, walkingTolerance, fallbackPolicy, includeExternalOffers?, offerCategories?}`
- `get-trip`: `{tripId}`
- `update-trip`: `{tripId, expectedTripRevision, patch:{title?, budget?, travelers?, vibe?, prompt?}}` — safe scalar patch under a revision lock; structural edits must use `propose-change`/`apply-change`.
- `get-place`: `{tripId+placeId}` or `{name, city}` — single place lookup; provider search marks `matchBasis:"provider_search"`.
- `search-places`: `{destination, query, category?, limit?}`
- `plan-route`: `{origin:{lat,lng}, destination:{lat,lng}, mode, city, fallbackPolicy}`
- `get-route-options`: `{origin:{lat,lng}, destination:{lat,lng}, city, modes?, context?, fallbackPolicy}` — compare walk/metro/bus/taxi/drive and return a ranked route matrix.
- `optimize-transport`: same input as `get-route-options`; returns the recommended option plus alternatives and scoring reasons.
- `retrieve-travel-knowledge`: `{city, query, tags?, limit?}` — hybrid keyword + pgvector RAG when configured; otherwise curated local fallback. Results include source/confidence/freshness metadata where available. Live provider facts remain authoritative.
- `replan-trip`: `{tripId, dayId?, instruction?, context?, fallbackPolicy}` — recompute urban transport choices with RAG-aware planning context and create a proposal when a better route mode is found.
- `get-weather`: `{destination, dates, fallbackPolicy}`
- `search-flights`: `{departureCityCode, arrivalCityCode, departureDate, returnDate?, tripType?, cabinClass?, externalAgentName, ...}` — Fliggy top-client only; fails with `NO_PROVIDER_CONFIGURED` without credentials.
- `search-travel-offers`: `{origin?, destination, startDate?, endDate?, travelers?, budget?, query, city?, categories?}`
- `refresh-travel-offers`: `{tripId, expectedTripRevision, origin?, destination, startDate?, endDate?, travelers?, budget?, query, city?, categories?}`
- `reorder-day`: `{tripId, dayId, orderedItemIds, expectedTripRevision}` — reorder items in one day under a revision lock.
- `propose-change`: `{tripId, instruction, dayId?, asOf?, fallbackPolicy}` — returns `proposalId`, a one-time `proposalToken` (10-minute TTL), `baseRevision`, actions, and the full Diff metrics (walking distance before/after, cost delta, transit swaps, item changes). Show the Diff to the user before applying.
- `apply-change`: `{tripId, proposalId, expectedTripRevision, confirmed:true, proposalToken}` — the token is minted by `propose-change`, is single-use, and is bound to that proposal's changeSet hash. Rejections: `PROPOSAL_TOKEN_REQUIRED` (missing token), `PROPOSAL_TOKEN_INVALID` (wrong token), `PROPOSAL_EXPIRED` (past TTL), `PROPOSAL_TAMPERED` (stored changeSet no longer matches its minted hash), `PROPOSAL_ALREADY_APPLIED`, `PROPOSAL_NOT_FOUND` (applied proposals are deleted), `PROPOSAL_STALE` (trip moved on).
- `optimize-itinerary`: `{tripId, expectedTripRevision, strategy?, preserveMustVisit?, fallbackPolicy}` — Itinerary Optimizer v1. Re-clusters planned items geographically, orders each day by time windows (night views last, meals anchored), applies pace/walking/elderly profile caps, and shifts indoor places onto rainy days. Always returns a proposal (`proposalId` + one-time `proposalToken` + Diff) plus `optimization: {decisions[], warnings[], unresolvedConstraints[], estimatedWalkingMetersByDay}`; only `status:"planned"` items move — done/current items stay put. Opening hours and unknown weather are reported as unresolved constraints, never fabricated.
- `get-today-context`: `{tripId, dayId?, asOf?}` — Today Mode v2 read-only execution console: `current` stop, `next` hop (name, stay, `transit` mode/minutes/distance with estimated flag, `suggestedDeparture`, `estimatedArrival`), `remaining {places, walkMeters, estimatedEndTime}`, `lateMinutes` (vs `asOf`), `weather` (provenance-labeled; unknown stays unknown), and deterministic `suggestions[]` (rain / high_walking / late / far_next). Suggestions are advisory — apply any change through propose → Diff → `apply-change`.
- `search-social`: `{city, query?, poi?, platform?, limit?}` — live multi-platform social content; evidence carries platform, sourceId, sourceUrl, publishedAt, metrics, fetchedAt, confidence, poiMatches.
- `get-social-trending`: `{city, platform?, limit?}` — engagement-ranked trending observations.
- `get-social-evidence`: `{city, poi?, query?, tripId?, limit?}` — aggregated evidence plus crowd/trend context; with `tripId`, evidence is aligned to trip POIs (entity id or name containment; unmatched stays unknown).

## Reservations (Phase 6.1) — real-world commitments

Confirmed reservations are HARD constraints: replans and the optimizer schedule around them, never through them. Runtime owns `id`/`tripId`/`provenance` (callers cannot forge them); every write is revision-locked.

- `add-reservation`: `{tripId, expectedTripRevision, reservation:{type, title, startAt, endAt?, origin?, destination?, location?, provider?, confirmationCode?, price?, currency?, cancellationPolicy?, flexibility?, status?, linkedItemId?, notes?}}` — `type` ∈ flight|train|hotel|restaurant|attraction|activity|car|transfer|other; `status` ∈ tentative|confirmed|cancelled|completed; `flexibility` ∈ fixed|semiFlexible|flexible.
- `update-reservation`: `{tripId, expectedTripRevision, reservationId, patch}` — partial update; id/tripId/provenance.source are immutable.
- `remove-reservation`: `{tripId, expectedTripRevision, reservationId}` — rejects unknown ids (`RESERVATION_NOT_FOUND`).
- `get-reservations`: `{tripId, status?, type?}` — read-only list with filters.
- `import-reservations`: `{tripId, expectedTripRevision, vendor?, reservations:[…≤20]}` — bulk import; dedupes by confirmation code (authoritative) else type+startAt.

## Trip state & constraints (Phases 6.2/6.4) — deterministic, LLM-free

- `get-constraints`: `{tripId, dayId?}` — `hardConstraints[]`, `hardViolations[]`, `softPenalties[]`, `score`, `unresolvedConstraints[]` (unknowns never guessed), `evidence[]`.
- `get-trip-state`: `{tripId, asOf?}` — execution state at an instant: `phase`, `currentDay/currentItem/nextItem`, `lateByMinutes`/`aheadByMinutes`, `remainingWalkingMeters`, `estimatedFinishTime`, `activeReservations`, `upcomingHardConstraints`, `activeEvents`, `budgetState`, `riskLevel`, `constraintViolations`, `suggestedActions`, `stale` (>6h old snapshot).

## Travel events (Phases 6.3/6.8) — reality changes, normalized

Provider responses are NEVER propagated raw: everything normalizes into a TravelEvent first (17 types incl. FLIGHT_DELAYED / HEAVY_RAIN / POI_CLOSED / USER_LATE / WALKING_OVERLOAD).

- `record-travel-event`: `{tripId, expectedTripRevision, event:{type, severity?, effectiveFrom?, effectiveUntil?, source?, summary?, payload?, relatedEntities?}}` — runtime stamps id/occurredAt/provenance; declared source kept truthfully.
- `get-active-events`: `{tripId, asOf?, includeAcknowledged?}` — events covering the instant.
- `simulate-travel-event`: `{tripId, expectedTripRevision, incident: flight_delay|heavy_rain|poi_closed|user_late|road_congested, …}` — DEMO only; recorded as `source:"simulation"`.

## Event-driven replan (Phases 6.5/6.6)

- `analyze-event-impact`: `{tripId, eventId | event, asOf?}` — read-only: `affectedEntities[]`, `atRiskItemIds[]`, `impossibleItemIds[]`, `recoverableItemIds[]`, `timeDeltaMinutes`, `recommendedStrategy`, `options[]`, `unknowns[]`. Deterministic rule matrix.
- `propose-event-replan`: `{tripId, eventId | event, asOf?, strategy?: auto|shift|skip|indoorSwap|replace|release|reduceWalking|reduceBudget|swapMode|monitor, fallbackPolicy}` — returns the standard proposal (`proposalId` + one-time `proposalToken` + Diff). Reservation-linked items never dropped; `monitor` yields `proposalId: null` with analysis only.

## Traveler memory (Phase 6.9) — conservative, explicit-first

- `get-traveler-memory`: `{}` → `{memory, disclosure}`; `disclosure` is the 「根据你的旅行偏好…」 line consumers must show.
- `update-traveler-memory`: `{entries:[{key, value, source?}]}` — key ∈ pace|walkingTolerance|transportPreference|mealPreference|wakeTime|hotelPreference|budgetStyle|travelStyle.
- `delete-traveler-memory`: `{key}` / `disable-traveler-memory`: `{disabled}`.

Successful output:

```json
{"schemaVersion":"voyage.skill.v1","ok":true,"data":{},"warnings":[],"generatedAt":"2026-09-26T08:00:00.000Z","providerStatus":{"overall":"REAL","places":"REAL","routes":"REAL","weather":"REAL","travelOffers":"UNKNOWN","social":"UNKNOWN","knowledge":"UNKNOWN"}}
```

`providerStatus` levels: `REAL`, `ESTIMATED`, `CACHED`, `CURATED`, `SOCIAL`, `MOCK`, `UNKNOWN`, `UNAVAILABLE`, `UNSTRUCTURED`, `PERMISSION_REQUIRED`. `overall` degrades to the weakest level present.

Errors include `ok:false`, a stable `error.code`, and a non-zero exit code. Important codes include `NO_PROVIDER_CONFIGURED`, `PROVIDER_AUTH_FAILED`, `NO_POI_RESULTS`, `WEATHER_UNAVAILABLE`, `ROUTE_PROVIDER_UNAVAILABLE`, `PLACE_NOT_FOUND`, `CONFIRMATION_REQUIRED`, `REVISION_CONFLICT`, `PROPOSAL_STALE`, `PROPOSAL_TOKEN_REQUIRED`, `PROPOSAL_TOKEN_INVALID`, `PROPOSAL_EXPIRED`, `PROPOSAL_TAMPERED`, and `PROPOSAL_ALREADY_APPLIED`.
## Meituan offers

`search-travel-offers` accepts `origin`, `destination`, optional dates, `travelers`, `budget`, `query`, and `categories` (`train`, `hotel`, `flight`, `ticket`, `restaurant`, `coupon`). It returns `offers` plus raw response data and a `travelOffers` provider status.

`create-trip` accepts `includeExternalOffers: true` and `offerCategories`. It creates the AMap-backed Trip even when Meituan is unavailable; unavailable or unstructured results are reported in warnings and `trip.offerProviderStatus`.

`refresh-travel-offers` requires `tripId` and `expectedTripRevision`. It atomically replaces the saved offer snapshot and increments the Trip revision. It never runs automatically during `get-trip`.


## Transport intelligence

The multimodal route matrix evaluates `walk`, `metro`, `bus`, `taxi`, and `drive`.
Each option contains duration, distance, walking distance, transfer count, estimated cost,
data confidence, provenance, score breakdown, and human-readable reasons.

The scorer may use user context including budget sensitivity, walking tolerance, fatigue,
weather, traveler count, luggage, and accessibility needs. Fare values are explicitly marked
as estimated unless a live provider returns authoritative pricing.

## Knowledge base

The repository includes a curated local retrieval fallback and a Supabase pgvector schema
(`supabase/migrations/0003_travel_knowledge.sql`) for city rules, POI knowledge,
transport rules, and historical route cases. Knowledge records carry confidence, source,
freshness windows, and optional source URLs. They supplement rather than override live
weather, routing, inventory, and price providers.


## RAG Knowledge Engine v1

Knowledge ingestion uses versioned source documents under `knowledge/`, deterministic chunking,
optional OpenAI-compatible 1536-dimension embeddings, and Supabase tables
`knowledge_documents` / `knowledge_chunks`.

Hybrid retrieval uses keyword search and semantic similarity with reciprocal-rank fusion,
plus confidence, freshness, city, tags and authority boosts. If Supabase or embeddings are
not configured, the runtime degrades to local curated retrieval instead of failing.

`optimize-transport` and `replan-trip` return RAG evidence, retrieval metadata and citations
alongside route recommendations. These are explanations and planning evidence; live provider
facts continue to outrank RAG for weather, route duration, traffic, operating status,
availability and prices.

## UI-side trip editing commands — exposed on Web `/api/voyage/command` and the skill CLI, not on the LLM agent

These mutation commands drive the itinerary editor (drag & drop, add flows, task check-off).
All are revision-locked with `expectedTripRevision`; a stale revision is rejected with `REVISION_CONFLICT`.

- `add-place`: `{tripId, place, expectedTripRevision}` — bookmark a provider-verified place onto the trip map without scheduling it.
- `add-place-item`: `{tripId, place, dayId, expectedTripRevision}` — append a place to a day; the runtime appends under a revision lock, recomputes the day and returns the persisted trip.
- `import-route`: `{tripId, assignments:[{dayId, places}], createTasks?, expectedTripRevision}` — one-transaction guide import: places spread across days, each stop getting a check-in task; returns `importedCount`.
- `set-item-status`: `{tripId, itemId, status: planned|current|done|skipped, expectedTripRevision}` — check a stop off (done is immutable afterwards).
- `set-task-status`: `{tripId, taskId, status: todo|done, expectedTripRevision}` — persist a task checkbox.
- `restore-trip`: `{tripId, trip, expectedTripRevision}` — restore a full snapshot (undo/redo and local proposal apply path).
- `remove-item`: `{tripId, itemId, expectedTripRevision}` — remove a stop; the day's route and segments are recomputed server-side.
- `remove-day`: `{tripId, dayId, expectedTripRevision}` — remove an entire day and renumber the rest.
