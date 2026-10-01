# @voyage/mcp

MCP adapter for the Voyage Runtime. This package contains **no business logic**: every tool is a one-to-one schema translation onto the same `VoyageSkillRuntime` used by the CLI, the HTTP adapter (`/api/voyage/command`), and the Web agent.

## Run

From the repository root:

```bash
npm install
npx tsx packages/voyage-mcp/server.ts
```

The server speaks MCP over stdio. Point any MCP client at:

```json
{
  "command": "npx",
  "args": ["tsx", "packages/voyage-mcp/server.ts"],
  "cwd": "/path/to/voyage",
  "env": { "AMAP_SERVER_KEY": "...", "VOYAGE_DATA_DIR": "/path/to/data" }
}
```

Trips and proposals persist under `VOYAGE_DATA_DIR` (default `.voyage/` in the working directory), so MCP clients share state with the CLI and Web app when pointed at the same directory.

## Tools

`voyage_create_trip`, `voyage_get_trip`, `voyage_search_places`, `voyage_plan_route`, `voyage_get_route_options`, `voyage_optimize_transport`, `voyage_get_weather`, `voyage_retrieve_knowledge`, `voyage_search_social`, `voyage_search_offers`, `voyage_propose_change`, `voyage_apply_change`.

Input schemas are declarative shapes for client discovery; the runtime re-validates every payload against the canonical contracts in `src/skill/contracts.ts`. Failures return stable `error.code` envelopes (`INVALID_INPUT`, `PROVIDER_AUTH_FAILED`, `CONFIRMATION_REQUIRED`, `REVISION_CONFLICT`, …).

### Confirmation discipline (proposalToken)

`voyage_apply_change` only applies a proposal that carries `confirmed: true`, the expected revision, **and a valid `proposalToken`** minted by `voyage_propose_change`. The token is one-time, expires after 10 minutes, and is bound to the proposal's changeSet hash — a model cannot apply its own proposal without the proposal being fresh and unmodified. Rejections use stable codes: `PROPOSAL_TOKEN_REQUIRED`, `PROPOSAL_TOKEN_INVALID`, `PROPOSAL_EXPIRED`, `PROPOSAL_TAMPERED`, `PROPOSAL_ALREADY_APPLIED`, `PROPOSAL_STALE`.

`voyage_propose_change` returns a human-readable Diff summary (walking distance before/after, cost delta, transit swaps, item changes) alongside the JSON envelope, so the agent can show it to the user verbatim and ask for consent before applying.

### Tool annotations

All tools are registered with MCP tool annotations so hosts can gate destructive work behind a confirmation dialog: the nine read-only query tools carry `readOnlyHint: true`; `voyage_create_trip` and `voyage_propose_change` are non-destructive writes; `voyage_apply_change` carries `destructiveHint: true` and must only run after the user agreed to the shown Diff.

## Testing

```bash
npx vitest run tests/voyage-mcp.test.ts
```
