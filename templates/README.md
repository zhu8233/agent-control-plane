# Project templates

Copy into a **managed project** root to satisfy the ACP file protocol (see [docs/agent-control-plane-protocol.md](../docs/agent-control-plane-protocol.md) §5).

| Template | Copy to project root |
| --- | --- |
| [project-stub/task_plan.md](project-stub/task_plan.md) | `task_plan.md` |
| [project-stub/progress.md](project-stub/progress.md) | `progress.md` |
| [project-stub/findings.md](project-stub/findings.md) | `findings.md` |
| [project-stub/testenv.yaml](project-stub/testenv.yaml) | `testenv.yaml` (stub — replace with real contract) |
| [project-stub/artifacts/](project-stub/artifacts/) | `artifacts/replays`, `traces`, `reports` (empty placeholders) |

For richer templates, align with your installed `agent-visibility-workflow` skill templates.

Optional: add `testenv.yaml` per sandbox-test-framework when the repo has build/test commands.
