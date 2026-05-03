import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AcpStore } from './store.js';
import {
  assertAssignmentCreate,
  assertEvidence,
  assertGate,
  assertTeamPlan,
} from './validators.js';

function validationErrorReply(reply: FastifyReply, errors: unknown) {
  return reply.code(400).send({ error: 'validation_failed', details: errors });
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

  app.post<{ Params: { taskId: string }; Body: { claimed_by?: string } }>(
    '/api/tasks/:taskId/claim',
    async (req, reply) => {
      const claimedBy = req.body?.claimed_by ?? 'hermes';
      const r = store.claimTask(req.params.taskId, claimedBy);
      if ('error' in r) return reply.code(404).send({ error: 'not_found', task_id: req.params.taskId });
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
      if ('error' in r) return reply.code(404).send({ error: 'not_found', task_id: req.params.taskId });
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
      };
      const v = assertAssignmentCreate(merged);
      if (!v.ok) return validationErrorReply(reply, v.errors);
      const r = store.addAssignment(req.params.taskId, merged);
      if ('error' in r) return reply.code(404).send({ error: 'not_found', task_id: req.params.taskId });
      return { ok: true, assignment: r.assignment };
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
      const r = store.addEvidence(req.params.taskId, merged);
      if ('error' in r) return reply.code(404).send({ error: 'not_found', task_id: req.params.taskId });
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
    if ('error' in r) return reply.code(404).send({ error: 'not_found', task_id: req.params.taskId });
    return { ok: true, gate: r.gate };
  });
}
