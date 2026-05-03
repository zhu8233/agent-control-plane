# Release and privacy boundary

## Safe to publish on GitHub

- All files under this repository **except** real personal data copied in by operators.
- Protocol document, JSON Schemas, server/MCP **code**, templates with placeholders, **synthetic** `examples/*.json`.
- CI workflow, `LICENSE`, engineering docs.

## Never publish without redaction

- Personal knowledge vault contents (e.g. from `agents-knowledge-db` data repo).
- Production task payloads, assignee names, internal URLs.
- MCP bearer tokens, API keys, `.env`, private registry paths.
- Raw agent transcripts, full `artifacts/` from real runs, screenshots with sensitive UI.
- Windows `LocalOverrides`, production `mcp-access-policy.json` with real identities.

## Repository hygiene

- Keep `examples/` limited to synthetic fixtures.
- Use `ACP_REPO_ROOT` / `ACP_SERVER_URL` in local `.env` (gitignored) for integration tests.
- Before `git push`, run `git status` and ensure no accidental adds under `artifacts/` or private paths.
