# Runtime API

Invoke with `node skills/voyage/scripts/voyage.mjs <command> --input request.json` or pass `--input -` and write JSON on stdin.

Commands:

- `create-trip`: `{origin, destination, startDate, endDate|days, people, budget, preferences, walkingTolerance, fallbackPolicy, includeExternalOffers?, offerCategories?}`
- `get-trip`: `{tripId}`
- `search-places`: `{destination, query, category?, limit?}`
- `plan-route`: `{origin:{lat,lng}, destination:{lat,lng}, mode, city, fallbackPolicy}`
- `get-route-options`: `{origin:{lat,lng}, destination:{lat,lng}, city, modes?, context?, fallbackPolicy}` — compare walk/metro/bus/taxi/drive and return a ranked route matrix.
- `optimize-transport`: same input as `get-route-options`; returns the recommended option plus alternatives and scoring reasons.
- `retrieve-travel-knowledge`: `{city, query, tags?, limit?}` — hybrid keyword + pgvector RAG when configured; otherwise curated local fallback. Results include source/confidence/freshness metadata where available. Live provider facts remain authoritative.
- `replan-trip`: `{tripId, dayId?, instruction?, context?, fallbackPolicy}` — recompute urban transport choices with RAG-aware planning context and create a proposal when a better route mode is found.
- `get-weather`: `{destination, dates, fallbackPolicy}`
- `search-travel-offers`: `{origin?, destination, startDate?, endDate?, travelers?, budget?, query, city?, categories?}`
- `refresh-travel-offers`: `{tripId, expectedTripRevision, origin?, destination, startDate?, endDate?, travelers?, budget?, query, city?, categories?}`
- `propose-change`: `{tripId, instruction, dayId?, asOf?, fallbackPolicy}`
- `apply-change`: `{tripId, proposalId, expectedTripRevision, confirmed:true}`

Successful output:

```json
{"schemaVersion":"voyage.skill.v1","ok":true,"data":{},"warnings":[],"providerStatus":{"overall":"REAL","places":"REAL","routes":"REAL","weather":"REAL","travelOffers":"UNKNOWN"}}
```

Errors include `ok:false`, a stable `error.code`, and a non-zero exit code. Important codes include `NO_PROVIDER_CONFIGURED`, `PROVIDER_AUTH_FAILED`, `NO_POI_RESULTS`, `WEATHER_UNAVAILABLE`, `ROUTE_PROVIDER_UNAVAILABLE`, `CONFIRMATION_REQUIRED`, and `PROPOSAL_STALE`.
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
