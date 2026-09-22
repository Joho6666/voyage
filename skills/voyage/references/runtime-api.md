# Runtime API

Invoke with `node skills/voyage/scripts/voyage.mjs <command> --input request.json` or pass `--input -` and write JSON on stdin.

Commands:

- `create-trip`: `{origin, destination, startDate, endDate|days, people, budget, preferences, walkingTolerance, fallbackPolicy}`
- `get-trip`: `{tripId}`
- `search-places`: `{destination, query, category?, limit?}`
- `plan-route`: `{origin:{lat,lng}, destination:{lat,lng}, mode, city, fallbackPolicy}`
- `get-weather`: `{destination, dates, fallbackPolicy}`
- `propose-change`: `{tripId, instruction, dayId?, asOf?, fallbackPolicy}`
- `apply-change`: `{tripId, proposalId, expectedTripRevision, confirmed:true}`

Successful output:

```json
{"schemaVersion":"voyage.skill.v1","ok":true,"data":{},"warnings":[],"providerStatus":{"overall":"REAL","places":"REAL","routes":"REAL","weather":"REAL"}}
```

Errors include `ok:false`, a stable `error.code`, and a non-zero exit code. Important codes include `NO_PROVIDER_CONFIGURED`, `NO_POI_RESULTS`, `WEATHER_UNAVAILABLE`, `ROUTE_PROVIDER_UNAVAILABLE`, `CONFIRMATION_REQUIRED`, and `PROPOSAL_STALE`.
