# Voyage Travel Skill MVP

Voyage is an Agent-native travel runtime, not a prose itinerary generator. It returns structured Trips, provider provenance, routes, weather, TravelActions, and reviewable Diffs.

## Install and run

Requirements: Node.js 20+, npm, and Git. Copy this folder to another Agent Harness and run:

```bash
node skills/voyage/scripts/voyage.mjs create-trip --input request.json
```

The launcher prefers `VOYAGE_REPO`, then a containing Voyage checkout, and otherwise clones the pinned commit from `runtime.lock.json` into `VOYAGE_SKILL_CACHE` (or the OS cache directory). It installs dependencies locally with `npm ci`; it never installs globally.

## Environment

- `AMAP_SERVER_KEY`: server-side AMap Web Service key for real POI, routes, geocoding, and weather.
- `FLIGGY_APP_KEY` and `FLIGGY_APP_SECRET`: server-side TOP credentials for the optional flight search adapter.
- `FLIGGY_SESSION` and `FLIGGY_DISTRIBUTOR`: optional partner values required by some Fliggy products.
- `MEITUAN_HT_TOKEN`: server-side token for the official Meituan Travel Skill; never commit or expose it.
- `MEITUAN_RAW_JSON=1`: request raw JSON from the Meituan CLI when available.
- `FLIGGY_*` values are optional and require approved Fliggy/TOP partner permissions. Missing or rejected permissions are reported as `NOT_CONFIGURED` or `PERMISSION_REQUIRED`.
- `VOYAGE_DATA_DIR`: optional directory for authoritative Trips and proposals; default is `.voyage/` in the calling workspace.
- `VOYAGE_REPO`: optional existing Voyage checkout.
- `VOYAGE_SKILL_CACHE`: optional runtime cache directory.
- `VOYAGE_PROVIDER_FIXTURE` and `VOYAGE_ALLOW_MOCK=1`: deterministic tests only.

`NEXT_PUBLIC_AMAP_KEY` is not used by this CLI. LLM configuration is optional; rule planning remains available without it.

## Safety model

`propose-change` never mutates the authoritative Trip. It stores a proposal with a base revision and hash. `apply-change` requires `proposalId`, the expected revision, and `confirmed: true`; stale or already-used proposals are rejected.

## Commands

The commands are `create-trip`, `get-trip`, `update-trip`, `get-place`, `search-places`, `plan-route`, `get-route-options`, `optimize-transport`, `retrieve-travel-knowledge`, `replan-trip`, `get-weather`, `search-flights`, `search-travel-offers`, `refresh-travel-offers`, `reorder-day`, `propose-change`, `apply-change`, `search-social`, `get-social-trending`, and `get-social-evidence`. Every successful response is JSON on stdout with `schemaVersion: "voyage.skill.v1"`, warnings, `generatedAt`, and provider status. Logs are on stderr; fatal commands exit non-zero.

See the references and examples for complete request/response shapes.

## Current limits and roadmap

The MVP targets mainland China and uses AMap as its real place, route, and weather provider. Flight search is available only when an approved Fliggy TOP application has the `alitrip.flight.service.search` permission. Train timetable and seat availability are not provided by the current Fliggy API catalog; payment and OTA order fulfillment remain outside scope. Social commands require `TIKHUB_API_KEY` (and optionally `REDFOX_API_KEY`) on the server side; without credentials they return `UNAVAILABLE` rather than estimated content. The same command contracts are mirrored one-to-one by the `voyage_*` tools in `packages/voyage-mcp`.
## External travel offers

Voyage can optionally query the official Meituan Travel Skill from the server-side JSON runtime. AMap remains authoritative for places, routes, and weather; Meituan results are stored as read-only `trip.offers` snapshots with provider, fetched time, raw response, and booking links.

Set `MEITUAN_HT_TOKEN` in the process environment (never commit it) and use:

```bash
node skills/voyage/scripts/voyage.mjs search-travel-offers --input request.json
```

Add `includeExternalOffers: true` to `create-trip` to query offers alongside the AMap plan. Use `refresh-travel-offers` with `tripId` and `expectedTripRevision` for an explicit refresh. These commands only recommend and link out; they never place or pay for orders. When no approved OTA provider is available, the web Offers center provides official query links for 12306, flights, and hotels. Those links do not claim live prices, inventory, or ticket availability.
