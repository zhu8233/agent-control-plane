import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AcpStore, StoreError } from './store.js';
import { checkEvidenceUri } from './evidence-uri.js';
import {
  assertAssignmentCreate,
  assertAssignmentPatch,
  assertCoordinationEventCreate,
  assertEscalationCreate,
  assertEvidence,
  assertGate,
  assertHandoffCreate,
  assertTeamPlan,
  resolveClaimPostBody,
} from './validators.js';

function validationErrorReply(reply: FastifyReply, errors: unknown) {
  return reply.code(400).send({ error: 'validation_failed', details: errors });
}

function storeErrorReply(reply: FastifyReply, err: StoreError, detail?: string) {
  if (err === 'illegal_transition' || err === 'illegal_assignment_transition') {
    return reply.code(409).send({ error: err, detail: detail ?? null });
  }
  if (err === 'not_found') {
    return reply.code(404).send({ error: 'not_found' });
  }
  return reply.code(409).send({ error: err, detail: detail ?? null });
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function mergeTeamPlanPayload(taskId: string, body: Record<string, unknown>): Record<string, unknown> {
  const {
    assignment_ids: legacyAssign,
    assignments: bodyAssign,
    task_id: _ignoreTask,
    ...rest
  } = body;
  const assignments =
    (bodyAssign as string[] | undefined) ?? (legacyAssign as string[] | undefined) ?? [];
  return {
    ...rest,
    task_id: taskId,
    team_plan_id: (body.team_plan_id as string | undefined) || randomUUID(),
    assignments,
    status: (body.status as string | undefined) ?? 'draft',
  };
}

export async function registerRoutes(app: FastifyInstance, store: AcpStore): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, service: '@acp/server' }));

  app.get('/api/tasks', async () => ({ tasks: store.listTasks() }));

  app.post<{ Params: { taskId: string }; Body: unknown }>(
    '/api/tasks/:taskId/claim',
    async (req, reply) => {
      const resolved = resolveClaimPostBody(req.body);
      if (!resolved.ok) return validationErrorReply(reply, resolved.errors);
      const r = store.claimTask(req.params.taskId, resolved.claimed_by);
      if ('error' in r) return storeErrorReply(reply, r.error, r.detail);
      return { ok: true, task: r.task };
    },
  );

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/context', async (req, reply) => {
    const ctx = store.getContext(req.params.taskId);
    if ('error' in ctx) return reply.code(404).send({ error: 'not_found', task_id: req.params.taskId });
    return ctx;
  });

  app.post<{ Params: { taskId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/team-plan',
    async (req, reply) => {
      const body = asRecord(req.body);
      const merged = mergeTeamPlanPayload(req.params.taskId, body);
      const v = assertTeamPlan(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.setTeamPlan(req.params.taskId, merged);
      if ('error' in r) return storeErrorReply(reply, r.error, r.detail);
      return { ok: true, team_plan: r.team_plan };
    },
  );

  app.post<{ Params: { taskId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/assignments',
    async (req, reply) => {
      const body = asRecord(req.body);
      const merged = {
        ...body,
        task_id: req.params.taskId,
        assignment_id: (body.assignment_id as string | undefined) || randomUUID(),
        status: (body.status as string | undefined) ?? 'pending',
      };
      const v = assertAssignmentCreate(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.addAssignment(req.params.taskId, merged);
      if ('error' in r) return storeErrorReply(reply, r.error, r.detail);
      return { ok: true, assignment: r.assignment };
    },
  );

  app.patch<{ Params: { taskId: string; assignmentId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/assignments/:assignmentId',
    async (req, reply) => {
      const body = asRecord(req.body);
      const v = assertAssignmentPatch(body);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.updateAssignment(req.params.taskId, req.params.assignmentId, body);
      if ('error' in r) {
        if (r.error === 'not_found') {
          return reply.code(404).send({ error: 'not_found' });
        }
        return storeErrorReply(reply, r.error, r.detail);
      }
      return { ok: true, assignment: r.assignment };
    },
  );

  app.post<{ Params: { taskId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/events',
    async (req, reply) => {
      const body = asRecord(req.body);
      const merged = {
        ...body,
        task_id: req.params.taskId,
        coordination_event_id: (body.coordination_event_id as string | undefined) || randomUUID(),
        created_at: (body.created_at as string | undefined) || new Date().toISOString(),
      };
      const v = assertCoordinationEventCreate(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.appendCoordinationEvent(req.params.taskId, merged);
      if ('error' in r) return storeErrorReply(reply, r.error);
      return { ok: true, event: r.event };
    },
  );

  app.post<{ Params: { taskId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/handoffs',
    async (req, reply) => {
      const body = asRecord(req.body);
      const merged = {
        ...body,
        task_id: req.params.taskId,
        handoff_id: (body.handoff_id as string | undefined) || randomUUID(),
      };
      const v = assertHandoffCreate(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.addHandoff(req.params.taskId, merged);
      if ('error' in r) return storeErrorReply(reply, r.error);
      return { ok: true, handoff: r.handoff };
    },
  );

  app.post<{ Params: { taskId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/escalations',
    async (req, reply) => {
      const body = asRecord(req.body);
      const merged = {
        ...body,
        task_id: req.params.taskId,
        escalation_id: (body.escalation_id as string | undefined) || randomUUID(),
        status: (body.status as string | undefined) ?? 'open',
      };
      const v = assertEscalationCreate(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.addEscalation(req.params.taskId, merged);
      if ('error' in r) return storeErrorReply(reply, r.error);
      return { ok: true, escalation: r.escalation };
    },
  );

  app.post<{ Params: { taskId: string }; Body: Record<string, unknown> }>(
    '/api/tasks/:taskId/evidence',
    async (req, reply) => {
      const body = asRecord(req.body);
      const merged = {
        ...body,
        evidence_id: (body.evidence_id as string | undefined) || randomUUID(),
      };
      const v = assertEvidence(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const uriReason = checkEvidenceUri(String((merged as Record<string, unknown>).uri ?? ''), store.getRepoRoot());
      if (uriReason) {
        return reply.code(400).send({ error: 'invalid_evidence_uri', detail: uriReason });
      }
      const r = store.addEvidence(req.params.taskId, merged);
      if ('error' in r) return storeErrorReply(reply, r.error);
      return { ok: true, evidence: r.evidence };
    },
  );

  app.post<{
    Params: { taskId: string; gateId: string };
    Body: Record<string, unknown>;
  }>('/api/tasks/:taskId/gates/:gateId/result', async (req, reply) => {
    const body = asRecord(req.body);
    const merged = { ...body, gate_id: req.params.gateId };
    const v = assertGate(merged);
    if (!v.ok) return validationErrorReply(reply, v.errors);
    const r = store.setGateResult(req.params.taskId, req.params.gateId, merged);
    if ('error' in r) return storeErrorReply(reply, r.error, r.detail);
    return { ok: true, gate: r.gate };
  });
}
