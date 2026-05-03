# Agent Control Plane monorepo

`12-skills_Manager` — **Agent Control Plane** local-first monorepo: protocol, HTTP API, web console, MCP server for Hermes, and adapters.

## Layout

See [docs/engineering-layout.md](docs/engineering-layout.md).

## Contents

| Path | Description |
| --- | --- |
| [docs/agent-control-plane-protocol.md](docs/agent-control-plane-protocol.md) | Protocol: domain model, lifecycle, MCP, file protocol |
| [packages/protocol/](packages/protocol/) | `@acp/protocol` — JSON Schemas |
| [packages/server/](packages/server/) | `@acp/server` — Fastify API (scaffold) |
| [packages/web/](packages/web/) | `@acp/web` — React + Vite console (scaffold) |
| [packages/mcp-server/](packages/mcp-server/) | `@acp/mcp-server` — MCP for Hermes (scaffold) |
| [packages/adapters/](packages/adapters/) | `@acp/adapters` — TasksAgent / runners (placeholder) |
| [templates/](templates/) | File-protocol stubs for new projects |
| [examples/](examples/) | Synthetic fixtures (tasks, team, evidence — safe to commit) |
| [LICENSE](LICENSE) | MIT |
| [docs/release-boundary.md](docs/release-boundary.md) | What must not be published |

## Quick start

```bash
npm install
npm run validate:schemas
npm run typecheck
npm run typecheck:mcp
npm run build
```

On **Windows**, `npm run typecheck:mcp` may be very slow or run out of memory; use **WSL**, **GitHub Actions**, or rely on `npm run build --workspace=@acp/mcp-server` (esbuild) for local iteration. CI always runs `typecheck:mcp` on Ubuntu.

### Run server + MCP (local)

```bash
npm run build --workspace=@acp/server
node packages/server/dist/index.js
# other terminal:
npm run build --workspace=@acp/mcp-server
node packages/mcp-server/dist/index.js
```

**Do not commit**: real vault data, production tasks, API keys, private `LocalOverrides`.

## Version

Protocol draft: **0.1.0** (see document history in `docs/agent-control-plane-protocol.md`).
