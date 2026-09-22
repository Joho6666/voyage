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
- `VOYAGE_DATA_DIR`: optional directory for authoritative Trips and proposals; default is `.voyage/` in the calling workspace.
- `VOYAGE_REPO`: optional existing Voyage checkout.
- `VOYAGE_SKILL_CACHE`: optional runtime cache directory.
- `VOYAGE_PROVIDER_FIXTURE` and `VOYAGE_ALLOW_MOCK=1`: deterministic tests only.

`NEXT_PUBLIC_AMAP_KEY` is not used by this CLI. LLM configuration is optional; rule planning remains available without it.

## Safety model

`propose-change` never mutates the authoritative Trip. It stores a proposal with a base revision and hash. `apply-change` requires `proposalId`, the expected revision, and `confirmed: true`; stale or already-used proposals are rejected.

## Commands

The seven commands are `create-trip`, `get-trip`, `search-places`, `plan-route`, `get-weather`, `propose-change`, and `apply-change`. Every successful response is JSON on stdout with `schemaVersion: "voyage.skill.v1"`, warnings, and provider status. Logs are on stderr; fatal commands exit non-zero.

See the references and examples for complete request/response shapes.

## Current limits and roadmap

The MVP targets mainland China and uses AMap as its real provider. Hotel, rail, flight, payment, and OTA order fulfillment are outside scope. MCP is intentionally not included; the stable command contracts are designed for future one-to-one `voyage_*` MCP tools.
