# Runtime Command Exposure Matrix

One runtime (`VoyageSkillRuntime`), four adapters. The matrix below is the
audit of what each surface exposes today and what the MCP surface *should*
expose going forward: high-level capabilities, not the full CRUD surface.
Anything marked **not exposed** remains available to the Web UI through
`/api/voyage/command`; hiding it from MCP keeps external agents focused on
intent-level work instead of dozens of low-level mutations.

| Command | Web (`/api/voyage/command`) | Web Agent (LLM tools) | Skill CLI | MCP | Should expose on MCP? |
|---|---|---|---|---|---|
| `create-trip` | ✓ | — (planning flow) | ✓ | `voyage_create_trip` | ✓ keep |
| `get-trip` | ✓ | `get_trip` | ✓ | `voyage_get_trip` | ✓ keep |
| `update-trip` | ✓ | — | ✓ | — | not yet (scalar patch; UI concern) |
| `get-place` | ✓ | `get_place` | ✓ | — | fold into `search_places`; skip |
| `search-places` | ✓ | `search_places` | ✓ | `voyage_search_places` | ✓ keep |
| `plan-route` | ✓ | `plan_route` | ✓ | `voyage_plan_route` | ✓ keep |
| `get-route-options` | ✓ | `get_route_options` | ✓ | `voyage_get_route_options` | ✓ keep |
| `optimize-transport` | ✓ | `optimize_transport` | ✓ | `voyage_optimize_transport` | ✓ keep |
| `retrieve-travel-knowledge` | ✓ | `retrieve_travel_knowledge` | ✓ | `voyage_retrieve_knowledge` | ✓ keep |
| `replan-trip` | ✓ | `replan_trip` | ✓ | — | planned: high-level `voyage_adapt_trip` |
| `get-weather` | ✓ | `get_weather` | ✓ | `voyage_get_weather` | ✓ keep |
| `search-flights` | ✓ | — | ✓ | — | no (credential-gated, niche) |
| `search-travel-offers` | ✓ | `search_travel_offers` | ✓ | `voyage_search_offers` | env-gated (`VOYAGE_ENABLE_OFFER_TOOLS=1`) |
| `refresh-travel-offers` | ✓ | — | ✓ | — | no (mutation, niche) |
| `reorder-day` | ✓ | — | ✓ | — | no (fine-grained CRUD; UI concern) |
| `add-place-item` | ✓ | — | ✓ | — | no |
| `add-place` | ✓ | — | ✓ | — | no |
| `import-route` | ✓ | — | ✓ | — | planned: high-level `voyage_import_guide` |
| `set-item-status` | ✓ | — | ✓ | — | no |
| `set-task-status` | ✓ | — | ✓ | — | no |
| `restore-trip` | ✓ | — | ✓ | — | no (undo is a UI affordance) |
| `propose-change` | ✓ | `propose_change` | ✓ | `voyage_propose_change` | ✓ keep |
| `apply-change` | ✓ | hard-blocked for the LLM | ✓ | `voyage_apply_change` | ✓ keep (proposalToken-gated) |
| `optimize-itinerary` | ✓ | — | ✓ | `voyage_optimize_itinerary` | ✓ keep (Itinerary Optimizer v1) |
| `search-social` | ✓ | `search_social_travel` | ✓ | `voyage_search_social` | env-gated (`VOYAGE_ENABLE_SOCIAL_TOOLS=1`) |
| `get-social-trending` | ✓ | `find_trending_places` | ✓ | — | env-gated, together with `search-social` |
| `get-social-evidence` | ✓ | `get_social_evidence` | ✓ | — | env-gated, together with `search-social` |

Legend: `✓` exposed · `—` not exposed · env-gated tools are registered only
when the environment variable is set (social offers depend on keys most
users do not have, and default-off keeps the tool list honest).

Rules that keep this table true:

1. Adapters never duplicate business logic — a new command is exposed by
   adding it to `commandSchemas` + the runtime `execute()` switch, then
   (optionally) registering a thin MCP/Web Agent tool on top.
2. MCP tools map 1:1 onto runtime commands; they never reimplement scheduling,
   confirmation, or provider rules.
3. Every MCP write tool carries annotations (`readOnlyHint` / `destructiveHint`)
   and mutation flows go through proposal → Diff → proposalToken → apply.
