# @acp/mcp-server

Stdio **MCP server** for Hermes. Exposes tools that call `@acp/server` over HTTP.

## Env

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACP_SERVER_URL` | `http://127.0.0.1:3840` | Base URL of running ACP server |
| `ACP_API_TOKEN` | _(unset)_ | If the HTTP API requires auth, set to the same token; tools send `Authorization: Bearer …` |
| `ACP_MCP_DEBUG` | _(unset)_ | Set `1` to include raw error text and response bodies in tool error JSON |

## Tools (v0.2)

- `list_available_tasks`
- `claim_task` — `{ task_id, claimed_by? }`
- `get_task_context` — `{ task_id }`
- `create_team_plan` — `{ task_id, created_by, roles, gates, assignments?, ... }`
- `create_assignment` — `{ task_id, role, instructions, expected_outputs, evidence_requirements, ... }`
- `update_assignment_status` — `{ task_id, assignment_id, status, blocked_reason? }`
- `append_coordination_event` — `{ task_id, event_type, message, actor_type, ... }`
- `create_handoff` — `{ task_id, from_type, to_type, completed_work, remaining_work, evidence_refs, risks, ... }`
- `open_escalation` — `{ task_id, category, summary, options, ... }`
- `submit_evidence` — `{ task_id, type, uri, ... }`
- `mark_gate_result` — `{ task_id, gate_id, kind, status, ... }`

On HTTP errors, tools return MCP content with `isError: true`. By default the payload is redacted (`error`, `status`, `path` only). Set `ACP_MCP_DEBUG=1` for full `error` text and `details` (parsed response body when JSON).

## Build

Uses **esbuild** (fast bundle; TypeScript via esbuild). From monorepo root:

```bash
npm run build --workspace=@acp/mcp-server
```

**Typecheck:** from monorepo root run `npm run typecheck:mcp` (`tsc --noEmit` + 8GB heap). Tool `inputSchema` objects use `acpInputSchema()` to avoid deep Zod instantiation (TS2589) on all platforms.

## Run

Start `@acp/server` first, then point your MCP client at:

```bash
node packages/mcp-server/dist/index.js
```

See `examples/mcp-client-config.cursor.json` and `docs/local-mvp-runbook.md`.

Repository smoke scripts (`npm run smoke:mvp`, `npm run smoke:http`) hit the **HTTP API** directly; they do **not** start an MCP stdio session.
