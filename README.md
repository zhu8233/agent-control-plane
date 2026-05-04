# Agent Control Plane monorepo

`12-skills_Manager` — **Agent Control Plane** local-first monorepo: protocol, HTTP API, web console, MCP server for Hermes, and adapters.

## Layout

See [docs/engineering-layout.md](docs/engineering-layout.md).

## Contents

| Path | Description |
| --- | --- |
| [docs/agent-control-plane-protocol.md](docs/agent-control-plane-protocol.md) | Protocol: domain model, lifecycle, MCP, file protocol |
| [packages/protocol/](packages/protocol/) | `@acp/protocol` — JSON Schemas |
| [packages/server/](packages/server/) | `@acp/server` — Fastify API + SQLite persistence |
| [packages/web/](packages/web/) | `@acp/web` — React + Vite console |
| [packages/mcp-server/](packages/mcp-server/) | `@acp/mcp-server` — MCP for Hermes |
| [packages/adapters/](packages/adapters/) | `@acp/adapters` — TasksAgent / runners (placeholder) |
| [templates/](templates/) | File-protocol stubs for new projects |
| [examples/](examples/) | Synthetic fixtures (tasks, team, evidence — safe to commit) |
| [LICENSE](LICENSE) | MIT |
| [docs/local-mvp-runbook.md](docs/local-mvp-runbook.md) | Install, dev servers, MCP, smoke, data dirs |
| [docs/release-boundary.md](docs/release-boundary.md) | What must not be published |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Quick start

```bash
npm install
npm run validate:schemas
npm run lint
npm run typecheck
npm run typecheck:mcp
npm run build
npm test
npm run smoke:mvp
# optional alias (HTTP only — not stdio MCP):
npm run smoke:http
```

`typecheck:mcp` should stay fast after the `acpInputSchema` helper; CI runs it on Ubuntu. Local MVP details: **[docs/local-mvp-runbook.md](docs/local-mvp-runbook.md)**.

### Run server + web + MCP (local)

```bash
npm run dev:server
# other terminal:
npm run dev:web
# MCP (after build):
npm run build --workspace=@acp/mcp-server
node packages/mcp-server/dist/index.js
```

**Do not commit**: real vault data, production tasks, API keys, private `LocalOverrides`.

## Releases

- **v0.2.3** (2026-05-04) — evidence `file:` realpath + UNC guard, SQLite `user_version=0` migration fixes, claim POST tightening, Vite `ACP_API_TOKEN` fallback: [CHANGELOG](CHANGELOG.md).
- **v0.2.2** (2026-05-04) — claim/evidence validation, SQLite v2 composite keys, optional `ACP_API_TOKEN`, evidence URI policy, ESLint CI, MCP error redaction: [CHANGELOG](CHANGELOG.md).
- **v0.2.1** (2026-05-04) — multi-assignment + team plan update, web mutation errors, `smoke:http` naming: [CHANGELOG](CHANGELOG.md).
- **v0.2.0-local-mvp** (2026-05-04) — SQLite, coordination APIs, expanded MCP, web wiring, tests/smoke: [CHANGELOG](CHANGELOG.md).
- **v0.1.0** (2026-05-03) — first public **local-first** scaffold: [CHANGELOG](CHANGELOG.md) · [GitHub Release](https://github.com/zhu8233/agent-control-plane/releases/tag/v0.1.0).

**Protocol draft** — **0.1.0** (see document history in [`docs/agent-control-plane-protocol.md`](docs/agent-control-plane-protocol.md)).
