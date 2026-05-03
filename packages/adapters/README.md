# @acp/adapters

Pluggable **execution and task-surface adapters**:

| Adapter | Purpose |
| --- | --- |
| `tasks-agent` | Map ACP task/run model to `05-TasksAgent` repo on your machine |
| `file-protocol` | Read/write `task_plan.md`, `progress.md`, `findings.md`, `artifacts/` |
| `claude-code` / `cursor` / … | Optional CLI runners |

No code yet — add thin clients as the control plane API stabilizes.
