# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-03

### Added

- **Protocol** — `docs/agent-control-plane-protocol.md` and JSON Schemas under `packages/protocol/schemas/` (task, project, evidence, gate, team plan, Hermes coordination objects, event envelope).
- **Control plane API** — `packages/server`: Fastify in-memory store, seed from `examples/synthetic-task.json`, AJV validation on write routes (`/team-plan`, `/assignments`, `/evidence`, `/gates/.../result`).
- **MCP** — `packages/mcp-server`: stdio MCP tools calling the HTTP API (`list_available_tasks`, `claim_task`, `get_task_context`, `create_team_plan`, `submit_evidence`, `mark_gate_result`); Zod via `zod/v3` for SDK type compatibility.
- **Web** — `packages/web`: React + Vite console scaffold.
- **Tooling** — `npm run validate:schemas`, root `typecheck` / `typecheck:mcp`, GitHub Actions CI (`validate:schemas`, typecheck, build).
- **Templates & examples** — `templates/project-stub`, synthetic JSON under `examples/`.
- **License** — MIT (`LICENSE`).

### Notes

- **v0.1** is intentionally **local-first**: no SQLite/production persistence; suitable for protocol and integration experiments.
- Do not publish real vault data or secrets; see `docs/release-boundary.md`.

[0.1.0]: https://github.com/zhu8233/agent-control-plane/releases/tag/v0.1.0
