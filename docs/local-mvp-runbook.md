# Local MVP runbook

## Prerequisites

- Node.js **22+**
- npm 10+

## Install

```bash
npm ci
```

## One-time build

The MCP package bundles with esbuild; the server compiles with `tsc`:

```bash
npm run build
```

## Start the control plane API

```bash
npm run dev:server
```

Defaults:

- Listen: `127.0.0.1:3840`
- SQLite: `<repo>/.acp/data/acp.sqlite` (override with `ACP_DATA_DIR`)
- Seed: loads `examples/synthetic-task.json` when the DB has no tasks

## Start the web console

```bash
npm run dev:web
```

Open the printed URL (Vite dev server, default port `5174`). The Vite config proxies `/api` to `http://127.0.0.1:3840` and forwards `Authorization`. When the API runs with `ACP_API_TOKEN`, set the same value for MCP (`ACP_API_TOKEN`) and optionally put it in `.env.local` as `VITE_ACP_API_TOKEN`, or rely on the dev default: Vite also reads **`ACP_API_TOKEN`** from the environment for proxied `/api` calls (after any browser `Authorization` header).

## Cursor / Hermes MCP wiring

1. Build MCP once: `npm run build -w @acp/mcp-server`
2. Merge `examples/mcp-client-config.cursor.json` into your Cursor MCP settings (adjust `cwd` / paths if the repo lives elsewhere).
3. Ensure `ACP_SERVER_URL` matches the running server (default `http://127.0.0.1:3840`).
4. If the server uses `ACP_API_TOKEN`, set the same variable for the MCP process so tools send `Authorization: Bearer …`.

## Smoke (HTTP — same endpoints MCP uses)

Requires a prior server build:

```bash
npm run build -w @acp/server
npm run smoke:mvp
```

This spins up a temporary data directory, walks claim → team plan → assignment → evidence → events → handoff → escalation → gates → `completed`, then tears down.

- **`npm run smoke:http`** — same as `smoke:mvp` (preferred name: it is **not** an MCP stdio client).
- **`npm run smoke:mcp`** — legacy alias; still HTTP-only. True MCP-over-stdio smoke is not in CI yet.

## Tests / CI locally

```bash
npm test
```

## Data layout & cleanup

- Default DB directory: `.acp/` (gitignored). Delete `.acp/` to reset local state.
- Override directory: `ACP_DATA_DIR=/absolute/path/to/dir` (relative paths resolve from the repo root).

## Environment variables

| Variable | Purpose | Default |
|---------|---------|---------|
| `PORT` | HTTP port | `3840` |
| `ACP_REPO_ROOT` | Repo root for schema loading | auto from server package |
| `ACP_DATA_DIR` | SQLite directory | `<repo>/.acp/data` |
| `ACP_SERVER_URL` | MCP → HTTP base | `http://127.0.0.1:3840` |
| `ACP_API_TOKEN` | If set, all `/api/*` except `/api/health` require `Authorization: Bearer <token>`. **Vite** (dev) also uses it when `VITE_ACP_API_TOKEN` is unset, so one value can cover API + MCP + web proxy. | unset (open) |
| `VITE_ACP_API_TOKEN` | Dev only: Vite proxies `/api` and injects this Bearer when the browser request has no `Authorization` (overrides `ACP_API_TOKEN` for injection) | unset |
| `ACP_MCP_DEBUG` | MCP tool errors include raw HTTP/message details (`1`) | unset (stable errors) |

## Releasing `v0.2.0-local-mvp`

Tag and publish notes in `CHANGELOG.md`, then:

```bash
git tag v0.2.0-local-mvp
```
