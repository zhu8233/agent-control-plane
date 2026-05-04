# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-05-04

### Fixed

- **Evidence** — `file:` URIs must resolve to an **existing** path under the repo root (`realpath`); UNC `file://` targets rejected; missing files return `file_not_found`.
- **SQLite** — `user_version` 0 no longer marks databases v2 without migrating child tables: empty DB creates v2; non-empty DB detects v1 vs v2 child DDL, rewrites v1, creates missing child tables, or only bumps pragma when already v2.
- **Claim** — POST body JSON `null` is rejected; `acp-claim-post` schema `additionalProperties: false`.
- **Web** — Vite dev proxy injects `Authorization` from `ACP_API_TOKEN` when `VITE_ACP_API_TOKEN` is unset (same token as API/MCP).

[0.2.3]: https://github.com/zhu8233/agent-control-plane/compare/v0.2.2...v0.2.3

## [0.2.2] - 2026-05-04

### Added

- **API** — Optional `ACP_API_TOKEN` (Bearer) for all `/api/*` except `/api/health`; MCP and Vite proxy support.
- **Persistence** — SQLite schema **v2**: composite primary keys on per-task child rows (`assignments`, `evidences`, `handoffs`, `escalations`) with automatic migration from `user_version` 1.
- **Validation** — Claim POST body schema; evidence URI allowlist (`https`, loopback `http`, `file` under repo root; Windows cross-drive denied); tighter JSON Schemas on write (`additionalProperties: false`, size limits).
- **Resilience** — Tolerant hydration of corrupt child JSON (skip + warn; `ACP_STRICT_HYDRATE=1` fails fast); seed/`task_json` parse errors with `cause`; DB closed if store construction fails.
- **Tooling** — `npm run lint` (ESLint 9 flat config), CI step; MCP `ACP_MCP_DEBUG=1` for verbose tool errors.

### Fixed

- **Web** — Evidence/gate mutations invalidate the task that was mutated, not a stale selection.

[0.2.2]: https://github.com/zhu8233/agent-control-plane/compare/v0.2.1...v0.2.2

## [0.2.1] - 2026-05-04

### Fixed

- **Assignments** — Multiple `POST /assignments` on the same task after the first delegation (`delegated` / `coordinating`) without spurious `409`.
- **Team plan** — `POST /team-plan` can **update** the plan while the task remains `team_planned` (aligns with MCP `create_team_plan` wording).

### Changed

- **Web** — After claim, refresh task context; surface mutation errors (claim / evidence / gate).
- **Scripts / docs** — `npm run smoke:http` (HTTP-only); `smoke:mcp` kept as legacy alias; runbook + MCP README clarify this is **not** MCP stdio smoke.

### Added

- **Integration tests** for two assignments + second team-plan update.

[0.2.1]: https://github.com/zhu8233/agent-control-plane/compare/v0.2.0-local-mvp...HEAD

## [0.2.0] - 2026-05-04

### Added

- **SQLite persistence** — `better-sqlite3` under `ACP_DATA_DIR` (default `<repo>/.acp/data`), schema v1 + migrations (`packages/server/src/db.ts`).
- **Coordination API** — `PATCH /assignments/:id`, `POST /events`, `POST /handoffs`, `POST /escalations`; task/assignment lifecycle guards (`409` on illegal transitions).
- **MCP tools** — `create_assignment`, `update_assignment_status`, `append_coordination_event`, `create_handoff`, `open_escalation`; structured HTTP errors; `acpInputSchema` to keep `typecheck:mcp` stable.
- **Web console** — task list/context + claim / evidence / gate actions (`packages/web`).
- **Testing & smoke** — `tsx` + Node test runner integration tests; `npm run smoke:mvp` / `smoke:mcp` (HTTP parity with MCP).
- **Docs & examples** — `docs/local-mvp-runbook.md`, `examples/mcp-client-config.cursor.json`.
- **CI** — job timeout, `npm test`, smoke after build.

### Changed

- **Validators** — fresh AJV instance per server boot; derived schema `$id` URLs compatible with JSON Schema 2020-12 / Ajv2020 (no illegal `#fragment` ids).
- **Root scripts** — `dev:server`, `dev:web`, `test`, `smoke:*`.

### Notes

- Release tag name: **`v0.2.0-local-mvp`** (see runbook).

[0.2.0]: https://github.com/zhu8233/agent-control-plane/releases/tag/v0.2.0-local-mvp

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
