# Data rules

Trips must satisfy the existing Voyage Zod Trip Schema. Place IDs, coordinates, route geometry, and weather dates come from the runtime/provider; an LLM may only select server-provided IDs.

Provenance levels are `REAL`, `ESTIMATED`, `MOCK`, and `UNKNOWN`. A real AMap route has `provider: "amap"` and `estimated: false`; a Haversine route has `provider: "haversine"`, `estimated: true`, and a warning. Weather is joined by ISO `Day.date`, never array position.

Every proposal includes actions, `baseRevision`, a before/after Trip Diff, and a proposed Trip that is not authoritative until Apply succeeds.
