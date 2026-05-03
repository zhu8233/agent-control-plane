import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TaskState {
  task: Record<string, unknown>;
  claimed_by?: string;
  team_plan?: Record<string, unknown>;
  assignments: Map<string, Record<string, unknown>>;
  evidences: Map<string, Record<string, unknown>>;
  gates: Map<string, Record<string, unknown>>;
  coordination_events: Array<Record<string, unknown>>;
}

export class AcpStore {
  readonly tasks = new Map<string, TaskState>();
  readonly defaultProject: Record<string, unknown>;

  constructor(repoRoot: string) {
    this.defaultProject = {
      project_id: 'example-project',
      name: 'Example project',
      root_path: repoRoot,
      type: 'code',
    };
    const seed = join(repoRoot, 'examples', 'synthetic-task.json');
    if (existsSync(seed)) {
      const raw = JSON.parse(readFileSync(seed, 'utf8')) as Record<string, unknown>;
      this.ensureTask(raw);
    }
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
      this.tasks.set(id, {
        task: { ...rest, assignments, gates, evidence_refs },
        assignments: new Map(),
        evidences: new Map(),
        gates: new Map(),
        coordination_events: [],
      });
    }
  }

  getTaskState(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  claimTask(taskId: string, claimedBy: string): { ok: true; task: Record<string, unknown> } | { error: 'not_found' } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
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
    return { ok: true, task: s.task };
  }

  setTeamPlan(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; team_plan: Record<string, unknown> } | { error: 'not_found' } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
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
    return { ok: true, team_plan: plan };
  }

  addAssignment(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; assignment: Record<string, unknown> } | { error: 'not_found' } {
    const s = this.tasks.get(taskId);
    if (!s) return { error: 'not_found' };
    const assignment_id = (body.assignment_id as string | undefined) || randomUUID();
    const a: Record<string, unknown> = { ...body, assignment_id, task_id: taskId };
    s.assignments.set(assignment_id, a);
    const ids = (s.task.assignments as string[]) ?? [];
    if (!ids.includes(assignment_id)) ids.push(assignment_id);
    s.task.assignments = ids;
    s.task.status = 'delegated';
    return { ok: true, assignment: a };
  }

  addEvidence(
    taskId: string,
    body: Record<string, unknown>,
  ): { ok: true; evidence: Record<string, unknown> } | { error: 'not_found' } {
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
    return { ok: true, evidence: e };
  }

  setGateResult(
    taskId: string,
    gateId: string,
    body: Record<string, unknown>,
  ): { ok: true; gate: Record<string, unknown> } | { error: 'not_found' } {
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
    return { ok: true, gate };
  }

  listTasks(): Array<Record<string, unknown>> {
    return [...this.tasks.values()].map((s) => ({
      task_id: s.task.task_id,
      status: s.task.status,
      title: s.task.title,
      project_id: s.task.project_id,
      claimed_by: s.claimed_by ?? null,
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
    };
  }
}
