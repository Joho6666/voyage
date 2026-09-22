---
name: voyage
description: Plan, inspect, and safely adapt real China travel itineraries with POI, route, and weather provenance through Voyage's JSON runtime.
---

# Voyage Travel Skill

Use this skill for real trip planning, place discovery, route planning, weather-aware adaptation, or changes to an existing Voyage Trip. Use the JSON CLI in `scripts/voyage.mjs`; do not invent coordinates, prices, route times, weather, or place facts.

Choose one workflow:

- **PLAN**: `create-trip` for a new structured Trip.
- **EXPLORE**: `search-places`, `plan-route`, or `get-weather` for verified data.
- **ADAPT**: `propose-change`, show the returned Diff, then call `apply-change` only after explicit user confirmation.
- **TODAY**: use `propose-change` with `asOf`; preserve `current`, `done`, and `skipped` items and adjust only future `planned` items.

Real AMap data is authoritative. Estimated, mock, unknown, and unavailable values must remain labeled in the response. A missing server key is an explicit provider error unless the request opts into `fallbackPolicy: "estimated"`; never silently turn a fallback into real data.

Read [references/runtime-api.md](references/runtime-api.md) for command contracts, [references/workflows.md](references/workflows.md) for routing rules, and [references/schemas.md](references/schemas.md) when validating structured output.
