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

Input schemas are declarative shapes for client discovery; the runtime re-validates every payload against the canonical contracts in `src/skill/contracts.ts`. Failures return stable `error.code` envelopes (`INVALID_INPUT`, `PROVIDER_AUTH_FAILED`, `CONFIRMATION_REQUIRED`, `REVISION_CONFLICT`, …). `voyage_apply_change` keeps the confirmation discipline: it only applies a proposal that carries `confirmed: true` plus the expected revision, which MCP clients must obtain from an explicit user confirmation.

## Testing

```bash
npx vitest run tests/voyage-mcp.test.ts
```
