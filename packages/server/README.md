# @acp/server

In-memory **Agent Control Plane API** (v0.1). Seeds one task from repo [`examples/synthetic-task.json`](../../examples/synthetic-task.json) at startup.

## Env

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3840` | Listen port |
| `ACP_REPO_ROOT` | auto (`packages/server` → three levels up) | Repo root (for seed file path) |

## Routes

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/health` | — |
| GET | `/api/tasks` | — |
| POST | `/api/tasks/:taskId/claim` | `{ "claimed_by"?: string }` |
| GET | `/api/tasks/:taskId/context` | — |
| POST | `/api/tasks/:taskId/team-plan` | Body must satisfy `acp-team-plan` after merging path `task_id`, defaulting `assignments`/`status`, and generating `team_plan_id` if omitted. Legacy key `assignment_ids` maps to `assignments`. **400** `validation_failed` if invalid. |
| POST | `/api/tasks/:taskId/assignments` | Body must satisfy assignment create schema (`assignment_id` optional; server may generate). **400** on invalid. |
| POST | `/api/tasks/:taskId/evidence` | Body must satisfy `acp-evidence` after generating `evidence_id` if omitted. **400** on invalid. |
| POST | `/api/tasks/:taskId/gates/:gateId/result` | Body + path `gate_id` must satisfy `acp-gate`. **400** on invalid. |

## Run (dev)

```bash
npm run build
node dist/index.js
```

From monorepo root:

```bash
npm run build --workspace=@acp/server
node packages/server/dist/index.js
```
