# Workflows

## PLAN

Extract origin, destination, date range, travelers, budget, walking tolerance, and preferences. Call `create-trip`. Present provider status and warnings with the structured Trip.

## EXPLORE

Call the narrowest command needed. Treat POI, route, and weather as independent sources; do not infer missing values from another source.

## ADAPT

Load the authoritative Trip, call `propose-change`, present the returned actions and quantitative Diff, and wait for user confirmation. Only then call `apply-change` with the returned proposal ID and revision.

## TODAY

Pass `asOf` to `propose-change`. Select the matching ISO-date Day. Completed/current/skipped items are immutable; only future planned items may be replaced or reordered. Recompute affected routes and show the Diff.
