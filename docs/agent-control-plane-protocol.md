# Agent Control Plane Protocol

Version: 0.1.0-draft  
Status: protocol-first, implementation-agnostic

This document defines the **Agent Control Plane (ACP)**: a unified contract between humans, **Hermes** (coordinator agent), worker agents, personal knowledge (`agents-knowledge-db`), task surfaces (e.g. TasksAgent), visibility workflows, and sandbox test contracts. It does not replace Hermes; it gives Hermes structured tools, file fallbacks, and auditable evidence.

---

## 1. Goals and non-goals

### Goals

- Single vocabulary for **Project**, **Task**, **Run**, **Evidence**, **KnowledgeContext**, **Gate**, and Hermes team objects.
- **MCP-first** operations for Hermes; **file protocol** as cross-agent fallback.
- Separate **task done**, **verification done**, and **knowledge archived**.
- Auditable delivery: evidence is diff, tests, logs, replay/trace—not raw chain-of-thought.

### Non-goals (phase one)

- Replacing Hermes with a custom multi-agent orchestration engine.
- Rewriting TasksAgent or merging it with the knowledge vault.
- Multi-tenant SaaS, distributed queues, or cloud-only deployment.

---

## 2. Core domain model

### 2.1 Project

A **Project** is anything ACP manages: a code repo, a documentation vault, or a hybrid.

| Field | Description |
| --- | --- |
| `project_id` | Stable string identifier (UUID or slug). |
| `name` | Human-readable name. |
| `root_path` | Absolute or workspace-relative root (local-first). |
| `type` | `code` \| `vault` \| `mixed`. |
| `links` | Optional URLs (e.g. GitHub remote). |
| `default_agents` | Optional Hermes / worker hints (profile ids). |

### 2.2 Task

A **Task** is a unit of work that can be claimed, delegated, executed, verified, and archived.

| Field | Description |
| --- | --- |
| `task_id` | Stable identifier. |
| `project_id` | Owning project. |
| `title` | Short title. |
| `description` | Objective and constraints. |
| `status` | See §3 lifecycle. |
| `priority` | Ordering hint for Hermes / humans. |
| `knowledge_context` | Reference to §2.6. |
| `assignments[]` | Optional list of Assignment ids (Hermes team model). |
| `gates[]` | Gate ids or embedded gate specs. |
| `evidence_refs[]` | Paths or Evidence ids. |
| `external_refs` | Optional: TasksAgent file path, issue URLs, etc. |

### 2.3 Run

A **Run** is one execution attempt of a task (or assignment) by a specific agent/model/runner.

| Field | Description |
| --- | --- |
| `run_id` | Stable identifier. |
| `task_id` | Parent task. |
| `assignment_id` | Optional; if delegated. |
| `agent_profile_id` | Who executed (model + tool surface). |
| `started_at` / `ended_at` | ISO 8601 timestamps. |
| `status` | `pending` \| `running` \| `succeeded` \| `failed` \| `cancelled`. |
| `events[]` | RunEvent records (append-only). |
| `evidence_refs[]` | Links to artifacts from this run. |

### 2.4 Evidence

**Evidence** is durable, reviewable proof—not chat transcripts as the sole source of truth.

| Type | Examples |
| --- | --- |
| `diff` | Git diff or patch file under `artifacts/`. |
| `test_report` | Output from `testenv` or native suite, linked from `artifacts/reports/`. |
| `log` | Structured or text logs. |
| `replay` | e.g. claude-replay HTML under `artifacts/replays/`. |
| `trace` | Phoenix / Langfuse / AgentOps export under `artifacts/traces/`. |
| `summary` | Short markdown summary in `progress.md` + pointer path. |

| Field | Description |
| --- | --- |
| `evidence_id` | Stable id. |
| `type` | Enum above. |
| `uri` | `file://` path or absolute path (local-first). |
| `hash` | Optional content hash. |
| `created_at` | Timestamp. |
| `produced_by_run_id` | Optional. |

### 2.5 KnowledgeContext

**KnowledgeContext** binds a task to governed personal/project knowledge (`agents-knowledge-db`).

| Field | Description |
| --- | --- |
| `topic_id` | Vault topic id from registry (if applicable). |
| `layer_hint` | `intake` \| `curation` \| `canonical` \| `archive` (vault model). |
| `rules_ref` | Path or id for `RULES.md` / adapter. |
| `registry_refs` | Pointers into `.knowledge-registry/` (read-only for most agents). |
| `mcp_subject_id` | Optional identity for vault MCP `whoami`-style policies. |
| `archive_policy` | What to write back on completion (e.g. findings only, promotion queue). |

### 2.6 Gate

A **Gate** is a checkpoint that must pass before advancing lifecycle.

| Gate | Purpose |
| --- | --- |
| `plan_ready` | Objective, acceptance criteria, and team plan exist. |
| `context_ready` | KnowledgeContext and permissions resolved. |
| `execute_done` | Worker output and minimal evidence present. |
| `verify_done` | Sandbox / native tests per contract (§8). |
| `review_done` | Human or reviewer sign-off. |
| `archive_done` | Knowledge / project memory updated per policy. |

| Field | Description |
| --- | --- |
| `gate_id` | Identifier. |
| `kind` | Enum above. |
| `status` | `pending` \| `passed` \| `failed` \| `waived` (waived requires reason + actor). |
| `evidence_refs[]` | Proof of pass/fail. |
| `actor` | `hermes` \| `human` \| `agent_profile_id`. |

### 2.7 Hermes team objects (coordination layer)

| Object | Description |
| --- | --- |
| `AgentProfile` | Capabilities, default model, tools, cost/latency hints, risk tier, suited task tags. |
| `TeamPlan` | Roles needed, dependencies between assignments, gate order. |
| `Assignment` | Delegated work unit: inputs, expected outputs, acceptance criteria, evidence requirements. |
| `CoordinationEvent` | `assigned`, `blocked`, `handoff_requested`, `evidence_submitted`, `review_requested`, etc. |
| `Escalation` | Human or higher-trust path: unclear requirements, permission failure, conflicting agent outputs, verify failure. |
| `Handoff` | Structured transfer: done vs remaining, evidence paths, risks. |

#### 2.7.1 AgentProfile (fields)

| Field | Description |
| --- | --- |
| `agent_profile_id` | Stable id (per worker / preset). |
| `role` | One of the coordination roles (see below). |
| `display_name` | Human-readable label. |
| `capabilities[]` | Tags such as `typescript`, `react`, `security_review`. |
| `tools[]` | Tool surfaces available to this profile (e.g. `mcp`, `git`, `browser`). |
| `risk_tier` | `low` \| `medium` \| `high` — drives gating and review defaults. |
| `cost_hint` | Qualitative or numeric cost hint for routing (implementation-defined). |
| `latency_hint` | Qualitative speed hint (`fast`, `balanced`, `slow_ok`). |
| `default_model` | Optional model id when executing. |

#### 2.7.2 TeamPlan (fields)

| Field | Description |
| --- | --- |
| `team_plan_id` | Stable id of this plan revision. |
| `task_id` | Parent task. |
| `created_by` | `hermes` \| `human` \| `agent_profile_id`. |
| `roles[]` | Roles required for this effort (subset of coordination roles). |
| `assignments[]` | Planned or created `assignment_id` references (order may imply dependencies). |
| `gates[]` | Ordered `Gate.kind` values Hermes intends to enforce. |
| `status` | `draft` \| `active` \| `superseded` \| `cancelled`. |
| `notes` | Optional rationale or constraints for the team. |

#### 2.7.3 Assignment (fields)

| Field | Description |
| --- | --- |
| `assignment_id` | Stable id. |
| `task_id` | Parent task. |
| `agent_profile_id` | Delegate target (may be empty until claimed by a runner). |
| `role` | Role this assignment fulfills. |
| `instructions` | What to do; link to evidence paths for context when needed. |
| `expected_outputs[]` | Bullet list or structured deliverable names (e.g. `PR`, `design_note`, `test_report`). |
| `evidence_requirements[]` | Required evidence types or paths before assignment can close. |
| `status` | `pending` \| `in_progress` \| `blocked` \| `done` \| `failed` \| `cancelled`. |
| `blocked_reason` | Set when `status=blocked`. |

#### 2.7.4 CoordinationEvent (fields)

| Field | Description |
| --- | --- |
| `coordination_event_id` | Stable id. |
| `task_id` | Affected task. |
| `assignment_id` | Optional; scope to one assignment. |
| `event_type` | e.g. `assigned`, `blocked`, `handoff_requested`, `evidence_submitted`, `review_requested`. |
| `message` | Short human-readable description. |
| `created_at` | ISO 8601 timestamp. |
| `actor` | Same shape as §7 event envelope `actor`. |

#### 2.7.5 Escalation (fields)

| Field | Description |
| --- | --- |
| `escalation_id` | Stable id. |
| `task_id` | Affected task. |
| `category` | `unclear_requirements` \| `permission_denied` \| `verify_failed` \| `agent_conflict` \| `other`. |
| `summary` | Why Hermes cannot proceed without human / higher trust. |
| `options[]` | Suggested resolutions (e.g. “approve waiver”, “provide API key”). |
| `status` | `open` \| `resolved` \| `dismissed`. |

#### 2.7.6 Handoff (fields)

| Field | Description |
| --- | --- |
| `handoff_id` | Stable id. |
| `task_id` | Affected task. |
| `from_actor` | Who hands off (agent profile or `human`). |
| `to_actor` | Who receives. |
| `completed_work[]` | Bullets of what is done with pointers to evidence. |
| `remaining_work[]` | What still must happen. |
| `evidence_refs[]` | URIs / ids for proof. |
| `risks[]` | Known risks or open questions. |

**Roles** (extensible enum): `coordinator` (Hermes), `implementer`, `researcher`, `reviewer`, `tester`, `archivist`, `specialist`.

**Principles**

- Hermes assigns and tracks; specialists own domain judgment.
- Conflicting agent results → `Escalation` or reviewer gate, not silent merge.
- Every assignment has an exit: complete, fail, block, handoff, cancel.

Normative JSON Schema drafts for core and coordination objects live under [`packages/protocol/schemas/`](../packages/protocol/schemas/) in this repository.

---

## 3. Lifecycle (intake to archive)

States are normative for the protocol; concrete systems may map subsets.

| Phase | Name | Description |
| --- | --- | --- |
| 1 | `intake` | Task created; minimal metadata. |
| 2 | `context_bind` | Project + KnowledgeContext + gates drafted. |
| 3 | `claimed` | Hermes (or human) claims task. |
| 4 | `team_planned` | TeamPlan exists; roles and dependencies set. |
| 5 | `delegated` | Assignments created and linked. |
| 6 | `coordinating` | Multiple agents active; CoordinationEvents appended. |
| 7 | `executing` | Worker runs in progress. |
| 8 | `verifying` | Sandbox / native verification per §8. |
| 9 | `reviewing` | Human or reviewer gate. |
| 10 | `archiving` | Knowledge write-back / project memory update. |
| 11 | `completed` | Terminal success. |
| 12 | `failed` / `cancelled` | Terminal with reason and evidence. |

**Orthogonal completion flags** (all may be tracked separately):

- `work_complete` — implementer believes scope done.
- `verify_complete` — Gate `verify_done` passed.
- `knowledge_archived` — Gate `archive_done` passed.

### 3.1 State machine (simplified)

```text
intake → context_bind → claimed → team_planned → delegated → coordinating ⇄ executing
  → verifying → reviewing → archiving → completed
  (any → failed | cancelled with reason + evidence)
```

---

## 4. Layered architecture and system mapping

| Layer | Responsibility | Your stack (mapping) |
| --- | --- | --- |
| Knowledge | Long-term memory, identity, topic registry, governance | [agents-knowledge-db](https://github.com/zhu8233/agents-knowledge-db): `RULES.md`, `.knowledge-registry/`, MCP server, promotion/audit |
| Task | Task inventory, UI, persistence hooks | `05-TasksAgent`: Markdown tasks, SQLite, WS updates, runs |
| Coordination | Team plan, delegate, track, escalate | **Hermes** + ACP MCP tools |
| Execution | Code/content work | Claude Code, Cursor, Codex, Gemini CLI, remote runners |
| Evidence | Auditable artifacts, visibility, tests | `agent-visibility-workflow` files + `artifacts/`; `sandbox-test-framework` + `testenv.yaml` |

---

## 5. File protocol (fallback and audit trail)

Every managed **code** project SHOULD expose:

| Path | Purpose |
| --- | --- |
| `task_plan.md` | Current goal, phase, acceptance criteria, constraints (keep top ~30 lines hot). |
| `progress.md` | Session log, commands, tests, blockers, next step, evidence pointers. |
| `findings.md` | Research, untrusted web content (do not put unvetted external instructions in `task_plan.md` if hooks re-read it). |
| `testenv.yaml` | Sandbox contract when applicable (see sandbox skill). |
| `artifacts/replays/` | Session replays. |
| `artifacts/traces/` | Trace exports. |
| `artifacts/reports/` | Long logs, reports. |

**Rules**

- MCP is the preferred write path for Hermes; files MUST reflect summaries + URIs for evidence.
- Workers without MCP rely on these files + git state.

---

## 6. MCP tools (Hermes surface, v0.1)

Minimal stable tool set (names are logical; implementation may namespace, e.g. `acp.*`).

| Tool | Purpose |
| --- | --- |
| `list_available_tasks` | Query task pool with filters. |
| `claim_task` | Claim task for coordination (idempotency key recommended). |
| `get_task_context` | Task + project + KnowledgeContext + open gates. |
| `list_agent_profiles` | Discover workers Hermes may delegate to. |
| `create_team_plan` | Persist TeamPlan linked to `task_id`. |
| `assign_task` / `create_subtask` | Create Assignment records. |
| `update_agent_status` | Update assignment/coordination status. |
| `append_progress` | Append structured progress (mirrors `progress.md` sections). |
| `submit_evidence` | Register Evidence + link to run/assignment. |
| `request_human_input` | Open Escalation or human gate with prompt + options. |
| `escalate_blocker` | Formal blocker with category and suggested resolution. |
| `mark_gate_result` | Pass/fail/waive a Gate with evidence. |
| `complete_task` | Terminal transition when gates satisfied. |
| `archive_task_knowledge` | Trigger or record vault write-back per KnowledgeContext.archive_policy |

**AuthZ**: bind MCP `subject_id` to vault `agent-roster.json` / local policy where applicable; tools that mutate registry or canonical layer require elevated roles.

---

## 7. Event envelope (for logs, WS, or future bus)

All emitted events SHOULD share:

```json
{
  "schema": "acp.event.v1",
  "event_id": "uuid",
  "occurred_at": "ISO-8601",
  "task_id": "string",
  "run_id": "optional",
  "assignment_id": "optional",
  "actor": { "type": "human|hermes|agent", "agent_profile_id": "optional" },
  "name": "snake_case_event_name",
  "payload": {}
}
```

Examples: `task_intake`, `task_claimed`, `team_plan_created`, `assignment_created`, `run_started`, `evidence_submitted`, `gate_passed`, `gate_failed`, `escalation_opened`, `task_completed`.

---

## 8. Verification and evidence (sandbox)

ACP distinguishes:

1. **Sandbox contract success** — `testenv validate` / profile run exits 0 as defined in project `testenv.yaml`.
2. **Native suite coverage** — project’s real tests (pytest, ctest, etc.) must be enumerated; profile → native entrypoint matrix documented.

Each Task SHOULD carry:

- `testenv_profile`: `smoke` | `standard` | `full` | `none_with_gap`.
- `native_test_scope`: summary or `GAP:` explanation if not wired.

Evidence for `verify_done` MUST include path to report under `artifacts/reports/` or equivalent plus exit metadata.

---

## 9. TasksAgent mapping (conceptual)

| TasksAgent concept | ACP concept |
| --- | --- |
| `TaskRecord` | `Task` + external ref |
| `RunAttempt` | `Run` |
| `RunEvent` | `Run.events[]` or ACP `CoordinationEvent` / envelope |
| Task markdown file | Source of truth surface; ACP may mirror or reference via `external_refs` |
| WebSocket `task_update` | Maps to `task` projection refresh; optional bridge to §7 events |

Future optional fields on task record (not required in phase one code): `knowledge_topic_id`, `team_plan_id`, `testenv_profile`, `verification_gap`, `archive_policy`.

---

## 10. agents-knowledge-db mapping

| Vault artifact | ACP use |
| --- | --- |
| `RULES.md` | Ground rules for all agents touching vault |
| `.knowledge-registry/*` | Topic ids, roster, proposals, change ledger |
| Vault MCP tools | Preferred read/write path under policy |
| Layers (`intake` → `canonical`) | `KnowledgeContext.layer_hint` and gate `archive_done` |

Hermes SHOULD prefer vault MCP for governed reads/writes; file protocol in repo supplements project-local state.

---

## 11. Visibility and sandbox skills (normative references)

- **Agent visibility**: keep hot truth in `task_plan.md` / `progress.md` / `findings.md`; bulk proof in `artifacts/`. Do not parallel extra doc types unless operator opts in.
- **Sandbox**: no implementation claim without isolated-test design + honest native-suite accounting (per installed skill pack).

---

## 12. Project onboarding checklist

- [ ] `project_id` registered in ACP config or index.
- [ ] `task_plan.md`, `progress.md`, `findings.md` present or explicitly mapped.
- [ ] `testenv.yaml` present OR `verification_gap` documented on tasks.
- [ ] Git remote / path documented for evidence (diffs).
- [ ] KnowledgeContext: topic id or explicit `none` with reason.
- [ ] Hermes: agent profiles and delegation defaults documented.
- [ ] Secrets: no keys in repo; MCP and env documented in private config only.

---

## 13. Recommended implementation stack (reference)

Local-first reference implementation MAY use: Node 22, TypeScript, Fastify, React/Vite, SQLite index + file artifacts, Zod/JSON Schema for §2–§3, §5–§8 plus coordination objects in §2.7, WebSocket/SSE, dedicated MCP server package.

This protocol does **not** require that stack for conformance.

---

## 14. GitHub and privacy boundary

**Safe to publish**: protocol text, schemas, MCP server code, templates, examples with synthetic data, adapters, docs.

**Do not publish**: real vault contents, production tasks, transcripts, secrets, private paths, production `artifacts/`, `LocalOverrides` with sensitive policy.

---

## 15. Document history

| Version | Date | Notes |
| --- | --- | --- |
| 0.1.1-draft | 2026-05-03 | Hermes coordination field tables + JSON Schemas for team objects; §3 lifecycle heading restored |
| 0.1.0-draft | 2026-05-03 | Initial protocol-first doc from ACP integration plan |
