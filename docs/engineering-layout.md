# Engineering layout (12-skills_Manager)

This repository implements the **Agent Control Plane** monorepo layout from the integration plan.

## Directory map

```text
.
├── package.json                 # npm workspaces root
├── docs/
│   ├── agent-control-plane-protocol.md
│   └── engineering-layout.md    # this file
├── packages/
│   ├── protocol/                # JSON Schemas (@acp/protocol)
│   ├── server/                  # Fastify API (@acp/server)
│   ├── web/                     # React console (@acp/web)
│   ├── mcp-server/              # Hermes MCP tools (@acp/mcp-server)
│   └── adapters/                # TasksAgent / runners (@acp/adapters)
├── templates/                   # File-protocol stubs for new projects
├── examples/                    # Synthetic fixtures (safe to commit)
└── scripts/                     # e.g. schema validation
```

## Commands

| Script | Purpose |
| --- | --- |
| `npm run validate:schemas` | Compile all `packages/protocol/schemas/*.json` with AJV and validate `examples/synthetic-*.json` |
| `npm run build` | Build all workspaces that define `build` |
| `npm run typecheck` | Typecheck workspaces that define `typecheck` (currently `@acp/server`, `@acp/web`) |
| `npm run typecheck:mcp` | `tsc --noEmit` for `packages/mcp-server` (runs in CI; on Windows may be slow—use WSL or rely on CI) |

## Bootstrap per package

```bash
npm install
npm run validate:schemas
# optional: wire individual packages
cd packages/server && npm install && npm run build && node dist/index.js
```

## Boundaries

- **Public**: code, schemas, docs, synthetic examples.
- **Private**: real vault data, production tasks, secrets — never commit under this tree without redaction.
