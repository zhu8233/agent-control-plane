# @acp/mcp-server

Stdio **MCP server** for Hermes. Exposes tools that call `@acp/server` over HTTP.

## Env

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACP_SERVER_URL` | `http://127.0.0.1:3840` | Base URL of running ACP server |

## Tools (v0.1)

- `list_available_tasks`
- `claim_task` — `{ task_id, claimed_by? }`
- `get_task_context` — `{ task_id }`
- `create_team_plan` — `{ task_id, created_by, roles, gates, assignments?, ... }`
- `submit_evidence` — `{ task_id, type, uri, ... }`
- `mark_gate_result` — `{ task_id, gate_id, kind, status, ... }`

On HTTP errors, tools return MCP content with `isError: true` and a JSON `{ "error": "..." }` payload.

## Build

Uses **esbuild** (fast bundle; TypeScript via esbuild). From monorepo root:

```bash
npm run build --workspace=@acp/mcp-server
```

**Typecheck:** from monorepo root run `npm run typecheck:mcp` (`tsc --noEmit` + 8GB heap). CI runs this after `npm run typecheck`. On **Windows**, that `tsc` step may be very slow or OOM—use **WSL** or rely on CI; local iteration can use esbuild `build` only.

**Note:** If you still hit OOM, raise the heap via `NODE_OPTIONS` or run `typecheck:mcp` on Linux/WSL only.

## Run

Start `@acp/server` first, then point your MCP client at:

```bash
node packages/mcp-server/dist/index.js
```
