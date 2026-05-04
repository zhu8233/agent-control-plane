import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  assertAssignmentTransition,
  assertCanCreateAssignment,
  assertTaskTransition,
  isAssignmentStatus,
} from './lifecycle.js';

function isStrictHydrate(): boolean {
  return process.env.ACP_STRICT_HYDRATE === '1';
}

export class TaskJsonCorruptError extends Error {
  readonly taskId: string;

  constructor(taskId: string, cause?: unknown) {
    const hint = cause instanceof Error ? cause.message : cause !== undefined ? String(cause) : '';
    super(`corrupt task_json for task_id=${taskId}${hint ? `: ${hint}` : ''}`, {
      cause: cause,
    });
    this.name = 'TaskJsonCorruptError';
    this.taskId = taskId;
  }
}

export interface TaskState {
  task: Record<string, unknown>;
  claimed_by?: string;
  team_plan?: Record<string, unknown>;
  assignments: Map<string, Record<string, unknown>>;
  evidences: Map<string, Record<string, unknown>>;
  gates: Map<string, Record<string, unknown>>;
  coordination_events: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
  escalations: Map<string, Record<string, unknown>>;
}

export type StoreError =
  | 'not_found'
  | 'illegal_transition'
  | 'illegal_assignment_transition'
  | 'conflict';

function emptyTaskState(task: Record<string, unknown>, claimedBy?: string): TaskState {
  return {
    task,
    claimed_by: claimedBy,
    assignments: new Map(),
    evidences: new Map(),
    gates: new Map(),
    coordination_events: [],
    handoffs: new Map(),
    escalations: new Map(),
  };
}

export class AcpStore {
  readonly tasks = new Map<string, TaskState>();
  readonly defaultProject: Record<string, unknown>;
  private readonly repoRoot: string;
  private readonly db: Database.Database;

  getRepoRoot(): string {
    return this.repoRoot;
  }

  constructor(repoRoot: string, db: Database.Database) {
    this.repoRoot = repoRoot;
    this.db = db;
    this.defaultProject = {
      project_id: 'example-project',
      name: 'Example project',
      root_path: repoRoot,
      type: 'code',
    };
    this.hydrateFromDb();
    const seed = join(repoRoot, 'examples', 'synthetic-task.json');
    if (this.tasks.size === 0 && existsSync(seed)) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(seed, 'utf8')) as Record<string, unknown>;
      } catch (e) {
        throw new Error(`ACP seed JSON invalid: ${seed}`, { cause: e });
      }
      this.ensureTask(raw);
      const id = String(raw.task_id);
      this.persistTask(id);
    }
  }

  /* ─── hydrate / persist ─── */

  private parseJsonRow(
    kind: string,
    taskId: string,
    rowLabel: string,
    json: string,
  ): Record<string, unknown> | null {
    try {
      const v = JSON.parse(json) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        throw new Error(`expected JSON object, got ${typeof v}`);
      }
      return v as Record<string, unknown>;
    } catch (e) {
      const msg = `[acp] ${kind} corrupt task_id=${taskId} ${rowLabel}: ${e instanceof Error ? e.message : e}`;
      if (isStrictHydrate()) throw new Error(msg, { cause: e });
      console.warn(msg);
      return null;
    }
  }

  private hydrateFromDb(): void {
    const rows = this.db
      .prepare('SELECT task_id, task_json, claimed_by FROM tasks')
      .all() as Array<{ task_id: string; task_json: string; claimed_by: string | null }>;
    for (const row of rows) {
      let task: Record<string, unknown>;
      try {
        const t = JSON.parse(row.task_json) as unknown;
        if (!t || typeof t !== 'object' || Array.isArray(t)) {
          throw new Error(`expected JSON object for task_json`);
        }
        task = t as Record<string, unknown>;
      } catch (e) {
        throw new TaskJsonCorruptError(row.task_id, e);
      }
      const s = emptyTaskState(task, row.claimed_by ?? undefined);
      this.loadChildren(s, row.task_id);
      this.tasks.set(row.task_id, s);
    }
  }

  private loadChildren(s: TaskState, taskId: string): void {
    const tp = this.db
      .prepare('SELECT plan_json FROM team_plans WHERE task_id = ?')
      .get(taskId) as { plan_json: string } | undefined;
    if (tp) {
      const plan = this.parseJsonRow('team_plan', taskId, '', tp.plan_json);
      if (plan) s.team_plan = plan;
    }

    const assigns = this.db
      .prepare('SELECT assignment_id, body_json FROM assignments WHERE task_id = ?')
      .all(taskId) as Array<{ assignment_id: string; body_json: string }>;
    for (const a of assigns) {
      const body = this.parseJsonRow('assignment', taskId, `assignment_id=${a.assignment_id}`, a.body_json);
      if (body) s.assignments.set(a.assignment_id, body);
    }

    const evs = this.db
      .prepare('SELECT evidence_id, body_json FROM evidences WHERE task_id = ?')
      .all(taskId) as Array<{ evidence_id: string; body_json: string }>;
    for (const e of evs) {
      const body = this.parseJsonRow('evidence', taskId, `evidence_id=${e.evidence_id}`, e.body_json);
      if (body) s.evidences.set(e.evidence_id, body);
    }

    const gates = this.db
      .prepare('SELECT gate_id, body_json FROM gates WHERE task_id = ?')
      .all(taskId) as Array<{ gate_id: string; body_json: string }>;
    for (const g of gates) {
      const body = this.parseJsonRow('gate', taskId, `gate_id=${g.gate_id}`, g.body_json);
      if (body) s.gates.set(g.gate_id, body);
    }

    const events = this.db
      .prepare('SELECT id, event_json FROM coordination_events WHERE task_id = ? ORDER BY id ASC')
      .all(taskId) as Array<{ id: number; event_json: string }>;
    const evList: Array<Record<string, unknown>> = [];
    for (const r of events) {
      const ev = this.parseJsonRow('coordination_event', taskId, `row id=${r.id}`, r.event_json);
      if (ev) evList.push(ev);
    }
    s.coordination_events = evList;

    const handoffs = this.db
      .prepare('SELECT handoff_id, body_json FROM handoffs WHERE task_id = ?')
      .all(taskId) as Array<{ handoff_id: string; body_json: string }>;
    for (const h of handoffs) {
      const body = this.parseJsonRow('handoff', taskId, `handoff_id=${h.handoff_id}`, h.body_json);
      if (body) s.handoffs.set(h.handoff_id, body);
    }

    const esc = this.db
      .prepare('SELECT escalation_id, body_json FROM escalations WHERE task_id = ?')
      .all(taskId) as Array<{ escalation_id: string; body_json: string }>;
    for (const e of esc) {
      const body = this.parseJsonRow('escalation', taskId, `escalation_id=${e.escalation_id}`, e.body_json);
      if (body) s.escalations.set(e.escalation_id, body);
    }
  }

  persistTask(taskId: string): void {
    const s = this.tasks.get(taskId);
    if (!s) return;
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO tasks (task_id, task_json, claimed_by) VALUES (?, ?, ?)')
        .run(taskId, JSON.stringify(s.task), s.claimed_by ?? null);

      if (s.team_plan) {
        this.db.prepare('INSERT OR REPLACE INTO team_plans (task_id, plan_json) VALUES (?, ?)').run(
          taskId,
          JSON.stringify(s.team_plan),
        );
      } else {
        this.db.prepare('DELETE FROM team_plans WHERE task_id = ?').run(taskId);
      }

      this.db.prepare('DELETE FROM assignments WHERE task_id = ?').run(taskId);
      const insA = this.db.prepare(
        'INSERT INTO assignments (task_id, assignment_id, body_json) VALUES (?, ?, ?)',
      );
      for (const [id, body] of s.assignments) {
        insA.run(taskId, id, JSON.stringify(body));
      }

      this.db.prepare('DELETE FROM evidences WHERE task_id = ?').run(taskId);
      const insE = this.db.prepare(
        'INSERT INTO evidences (task_id, evidence_id, body_json) VALUES (?, ?, ?)',
      );
      for (const [id, body] of s.evidences) {
        insE.run(taskId, id, JSON.stringify(body));
      }

      this.db.prepare('DELETE FROM gates WHERE task_id = ?').run(taskId);
      const insG = this.db.prepare(
        'INSERT INTO gates (gate_id, task_id, body_json) VALUES (?, ?, ?)',
      );
      for (const [id, body] of s.gates) {
        insG.run(id, taskId, JSON.stringify(body));
      }

      this.db.prepare('DELETE FROM coordination_events WHERE task_id = ?').run(taskId);
      const insEv = this.db.prepare(
        'INSERT INTO coordination_events (task_id, event_json) VALUES (?, ?)',
      );
      for (const ev of s.coordination_events) {
        insEv.run(taskId, JSON.stringify(ev));
      }

      this.db.prepare('DELETE FROM handoffs WHERE task_id = ?').run(taskId);
      const insH = this.db.prepare(
        'INSERT INTO handoffs (task_id, handoff_id, body_json) VALUES (?, ?, ?)',
      );
      for (const [id, body] of s.handoffs) {
        insH.run(taskId, id, JSON.stringify(body));
      }

      this.db.prepare('DELETE FROM escalations WHERE task_id = ?').run(taskId);
      const insX = this.db.prepare(
        'INSERT INTO escalations (task_id, escalation_id, body_json) VALUES (?, ?, ?)',
      );
      for (const [id, body] of s.escalations) {
        insX.run(taskId, id, JSON.stringify(body));
      }
    });
    tx();
  }

  ensureTask(task: Record<string, unknown>): void {
    const id = String(task.task_id);
    if (!this.tasks.has(id)) {
      const assignments =
        (task.assignments as string[] | undefined) ??
        (task.assignment_ids as string[] | undefined) ??
        [];
      const gates =
        (task.gates as string[] | undefined) ?? (task.gate_ids as string[] | undefined) ?? [];
      const evidence_refs = (task.evidence_refs as string[] | undefined) ?? [];
      const { assignment_ids: _a, gate_ids: _g, ...rest } = task;
      const normalized: Record<string, unknown> = {
        ...rest,
        assignments,
        gates,
        evidence_refs,
      };
      this.tasks.set(id, emptyTaskState(normalized));
      this.persistTask(id);
    }
  }

  getTaskState(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  /* ─── mutations ─── */

  claimTask(
    taskId: string,
    claimedBy: string,
  ): { ok: true; task: Record<string, unknown> } | { error: StoreError; detail?: string } {
    if (typeof claimedBy !== 'string' || claimedBy.trim().length === 0) {
      return { error: 'conflict', detail: 'claimed_by must be a non-empty string' };
    }
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const from = String(s.task.status ?? 'intake');
    const t = assertTaskTransition(from, 'claimed');
    if ('error' in t) return { error: 'illegal_transition', detail: t.error };

    s.claimed_by = claimedBy;
    s.task.status = 'claimed';
    s.coordination_events.push({
      coordination_event_id: randomUUID(),
      task_id: taskId,
      event_type: 'status_changed',
      message: `Task claimed by ${claimedBy}`,
      created_at: new Date().toISOString(),
      actor: { type: 'hermes' },
    });
    this.persistTask(taskId);
    return { ok: true, task: s.task };
  }

  setTeamPlan(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; team_plan: Record<string, unknown> } | { error: StoreError; detail?: string } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const from = String(s.task.status ?? 'intake');

    if (from === 'team_planned') {
      const team_plan_id =
        (body.team_plan_id as string | undefined) ??
        (s.team_plan?.team_plan_id as string | undefined) ??
        randomUUID();
      const assignments =
        (body.assignments as string[] | undefined) ??
        (body.assignment_ids as string[] | undefined) ??
        [];
      const plan: Record<string, unknown> = {
        team_plan_id,
        task_id: taskId,
        created_by: body.created_by,
        roles: body.roles,
        assignments,
        gates: body.gates,
        status: body.status ?? 'draft',
        notes: body.notes,
      };
      s.team_plan = plan;
      s.task.team_plan_id = team_plan_id;
      s.coordination_events.push({
        coordination_event_id: randomUUID(),
        task_id: taskId,
        event_type: 'other',
        message: 'Team plan updated',
        created_at: new Date().toISOString(),
        actor: { type: 'hermes' },
      });
      this.persistTask(taskId);
      return { ok: true, team_plan: plan };
    }

    const t = assertTaskTransition(from, 'team_planned');
    if ('error' in t) return { error: 'illegal_transition', detail: t.error };

    const team_plan_id = (body.team_plan_id as string | undefined) || randomUUID();
    const assignments =
      (body.assignments as string[] | undefined) ??
      (body.assignment_ids as string[] | undefined) ??
      [];
    const plan: Record<string, unknown> = {
      team_plan_id,
      task_id: taskId,
      created_by: body.created_by,
      roles: body.roles,
      assignments,
      gates: body.gates,
      status: body.status ?? 'draft',
      notes: body.notes,
    };
    s.team_plan = plan;
    s.task.team_plan_id = team_plan_id;
    s.task.status = 'team_planned';
    s.coordination_events.push({
      coordination_event_id: randomUUID(),
      task_id: taskId,
      event_type: 'other',
      message: 'Team plan set',
      created_at: new Date().toISOString(),
      actor: { type: 'hermes' },
    });
    this.persistTask(taskId);
    return { ok: true, team_plan: plan };
  }

  addAssignment(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; assignment: Record<string, unknown> } | { error: StoreError; detail?: string } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const from = String(s.task.status ?? 'intake');
    const can = assertCanCreateAssignment(from);
    if ('error' in can) return { error: 'illegal_transition', detail: can.error };

    if (from === 'team_planned') {
      const t = assertTaskTransition(from, 'delegated');
      if ('error' in t) return { error: 'illegal_transition', detail: t.error };
      s.task.status = 'delegated';
    }

    const assignment_id = (body.assignment_id as string | undefined) || randomUUID();
    const status =
      (body.status as string | undefined) && isAssignmentStatus(String(body.status))
        ? body.status
        : 'pending';
    const a: Record<string, unknown> = { ...body, assignment_id, task_id: taskId, status };
    s.assignments.set(assignment_id, a);
    const ids = (s.task.assignments as string[]) ?? [];
    if (!ids.includes(assignment_id)) ids.push(assignment_id);
    s.task.assignments = ids;
    this.persistTask(taskId);
    return { ok: true, assignment: a };
  }

  updateAssignment(
    taskId: string,
    assignmentId: string,
    patch: Record<string, unknown>,
  ): { ok: true; assignment: Record<string, unknown> } | { error: StoreError; detail?: string } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const cur = s.assignments.get(assignmentId);
    if (!cur) return { error: 'not_found' };
    const fromStatus = String(cur.status ?? 'pending');
    const toStatus = patch.status !== undefined ? String(patch.status) : fromStatus;
    if (toStatus !== fromStatus) {
      const tr = assertAssignmentTransition(fromStatus, toStatus);
      if ('error' in tr) return { error: 'illegal_assignment_transition', detail: tr.error };
    }
    const next: Record<string, unknown> = {
      ...cur,
      ...patch,
      assignment_id: assignmentId,
      task_id: taskId,
    };
    s.assignments.set(assignmentId, next);

    let ts = String(s.task.status ?? 'intake');
    if (toStatus === 'in_progress' && (ts === 'delegated' || ts === 'team_planned')) {
      const t2 = assertTaskTransition(ts, 'coordinating');
      if (!('error' in t2)) {
        s.task.status = 'coordinating';
        ts = 'coordinating';
      }
    }
    if (toStatus === 'done' && (ts === 'coordinating' || ts === 'delegated')) {
      const t2 = assertTaskTransition(ts, 'executing');
      if (!('error' in t2)) s.task.status = 'executing';
    }

    this.persistTask(taskId);
    return { ok: true, assignment: next };
  }

  appendCoordinationEvent(
    taskId: string,
    partial: Record<string, unknown>,
  ): { ok: true; event: Record<string, unknown> } | { error: StoreError } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const ev: Record<string, unknown> = {
      coordination_event_id: partial.coordination_event_id ?? randomUUID(),
      task_id: taskId,
      assignment_id: partial.assignment_id,
      event_type: partial.event_type,
      message: partial.message,
      created_at: partial.created_at ?? new Date().toISOString(),
      actor: partial.actor,
    };
    s.coordination_events.push(ev);
    this.persistTask(taskId);
    return { ok: true, event: ev };
  }

  addHandoff(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; handoff: Record<string, unknown> } | { error: StoreError } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const handoff_id = (body.handoff_id as string | undefined) || randomUUID();
    const h: Record<string, unknown> = { ...body, handoff_id, task_id: taskId };
    s.handoffs.set(handoff_id, h);
    s.coordination_events.push({
      coordination_event_id: randomUUID(),
      task_id: taskId,
      event_type: 'handoff_requested',
      message: `Handoff ${handoff_id} recorded`,
      created_at: new Date().toISOString(),
      actor: { type: 'hermes' },
    });
    this.persistTask(taskId);
    return { ok: true, handoff: h };
  }

  addEscalation(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; escalation: Record<string, unknown> } | { error: StoreError } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const escalation_id = (body.escalation_id as string | undefined) || randomUUID();
    const e: Record<string, unknown> = {
      ...body,
      escalation_id,
      task_id: taskId,
      status: body.status ?? 'open',
    };
    s.escalations.set(escalation_id, e);
    s.coordination_events.push({
      coordination_event_id: randomUUID(),
      task_id: taskId,
      event_type: 'blocked',
      message: `Escalation ${escalation_id} opened`,
      created_at: new Date().toISOString(),
      actor: { type: 'hermes' },
    });
    this.persistTask(taskId);
    return { ok: true, escalation: e };
  }

  addEvidence(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; evidence: Record<string, unknown> } | { error: StoreError } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const evidence_id = (body.evidence_id as string | undefined) || randomUUID();
    const e: Record<string, unknown> = { ...body, evidence_id };
    s.evidences.set(evidence_id, e);
    const refs = (s.task.evidence_refs as string[]) ?? [];
    if (!refs.includes(evidence_id)) refs.push(evidence_id);
    s.task.evidence_refs = refs;
    s.coordination_events.push({
      coordination_event_id: randomUUID(),
      task_id: taskId,
      event_type: 'evidence_submitted',
      message: `Evidence ${evidence_id} registered`,
      created_at: new Date().toISOString(),
      actor: { type: 'hermes' },
    });
    this.persistTask(taskId);
    return { ok: true, evidence: e };
  }

  setGateResult(
    taskId: string,
    gateId: string,
    body: Record<string, unknown>,
  ): { ok: true; gate: Record<string, unknown> } | { error: StoreError; detail?: string } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const gate: Record<string, unknown> = {
      gate_id: gateId,
      kind: body.kind,
      status: body.status,
      evidence_refs: (body.evidence_refs as string[] | undefined) ?? [],
      waive_reason: body.waive_reason,
      actor: body.actor ?? 'hermes',
    };
    s.gates.set(gateId, gate);
    const gateIds = (s.task.gates as string[]) ?? [];
    if (!gateIds.includes(gateId)) {
      gateIds.push(gateId);
      s.task.gates = gateIds;
    }

    const kind = String(body.kind);
    const st = String(body.status);
    let ts = String(s.task.status ?? 'intake');

    if (kind === 'verify_done' && st === 'passed') {
      if (ts === 'executing' || ts === 'coordinating') {
        const t2 = assertTaskTransition(ts, 'verifying');
        if (!('error' in t2)) ts = (s.task.status = 'verifying') as string;
      }
    }
    if (kind === 'review_done' && st === 'passed' && ts === 'verifying') {
      const t2 = assertTaskTransition(ts, 'reviewing');
      if (!('error' in t2)) ts = (s.task.status = 'reviewing') as string;
    }
    if (kind === 'archive_done' && st === 'passed') {
      if (ts === 'reviewing') {
        const t2 = assertTaskTransition(ts, 'archiving');
        if (!('error' in t2)) ts = (s.task.status = 'archiving') as string;
      }
      if (ts === 'archiving') {
        const t3 = assertTaskTransition(ts, 'completed');
        if (!('error' in t3)) s.task.status = 'completed';
      }
    }

    this.persistTask(taskId);
    return { ok: true, gate };
  }

  /* ─── read ─── */

  listTasks(): Array<Record<string, unknown>> {
    return [...this.tasks.values()].map((st) => ({
      task_id: st.task.task_id,
      status: st.task.status,
      title: st.task.title,
      project_id: st.task.project_id,
      claimed_by: st.claimed_by ?? null,
    }));
  }

  getContext(
    taskId: string,
  ):
    | { error: 'not_found' }
    | {
        ok: true;
        project: Record<string, unknown>;
        task: Record<string, unknown>;
        claimed_by: string | undefined;
        team_plan: Record<string, unknown> | null;
        assignments: Array<Record<string, unknown>>;
        evidences: Array<Record<string, unknown>>;
        gates: Array<Record<string, unknown>>;
        coordination_events: Array<Record<string, unknown>>;
        handoffs: Array<Record<string, unknown>>;
        escalations: Array<Record<string, unknown>>;
      } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    return {
      ok: true,
      project: this.defaultProject,
      task: s.task,
      claimed_by: s.claimed_by,
      team_plan: s.team_plan ?? null,
      assignments: [...s.assignments.values()],
      evidences: [...s.evidences.values()],
      gates: [...s.gates.values()],
      coordination_events: s.coordination_events,
      handoffs: [...s.handoffs.values()],
      escalations: [...s.escalations.values()],
    };
  }
}
