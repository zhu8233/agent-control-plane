/**
 * @acp/mcp-server — Hermes-facing MCP tools (stdio). Calls @acp/server HTTP API.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
/** MCP SDK types target Zod v3; the default `zod` entry may resolve to v4 in this monorepo. */
import { z } from 'zod/v3';

const baseUrl = process.env.ACP_SERVER_URL ?? 'http://127.0.0.1:3840';
const apiToken = process.env.ACP_API_TOKEN?.trim();
const mcpDebug = process.env.ACP_MCP_DEBUG === '1';

function bearerHeaders(): Record<string, string> {
  if (!apiToken) return {};
  return { Authorization: `Bearer ${apiToken}` };
}

/** Avoid TS2589 / excessive instantiation from `registerTool` + nested Zod enums. */
function acpInputSchema(shape: Record<string, z.ZodTypeAny>): ZodRawShapeCompat {
  return shape as unknown as ZodRawShapeCompat;
}

export class AcpHttpError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: unknown;

  constructor(status: number, path: string, body: unknown, rawText: string) {
    super(`ACP HTTP ${status} ${path}: ${rawText}`);
    this.name = 'AcpHttpError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...bearerHeaders(),
      ...init?.headers,
    },
  });
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = { raw: text };
  }
  if (!r.ok) {
    throw new AcpHttpError(r.status, path, parsed, text);
  }
  return parsed;
}

function toolError(e: unknown) {
  if (e instanceof AcpHttpError) {
    const payload = mcpDebug
      ? { error: e.message, status: e.status, path: e.path, details: e.body }
      : { error: 'ACP HTTP request failed', status: e.status, path: e.path };
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }
  const msg = e instanceof Error ? e.message : String(e);
  const payload = mcpDebug ? { error: msg } : { error: 'Request failed' };
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

const gateKind = z.enum([
  'plan_ready',
  'context_ready',
  'execute_done',
  'verify_done',
  'review_done',
  'archive_done',
]);

const gateStatus = z.enum(['pending', 'passed', 'failed', 'waived']);

const evidenceType = z.enum(['diff', 'test_report', 'log', 'replay', 'trace', 'summary']);

type GateKind = z.infer<typeof gateKind>;
type GateStatus = z.infer<typeof gateStatus>;
type EvidenceType = z.infer<typeof evidenceType>;

const mcpServer = new McpServer({
  name: 'agent-control-plane',
  version: '0.2.3',
});

mcpServer.registerTool(
  'list_available_tasks',
  { description: 'List tasks from the Agent Control Plane' },
  async () => {
    try {
      const data = await api('/api/tasks');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const claimTaskShape = acpInputSchema({
  task_id: z.string().describe('ACP task id'),
  claimed_by: z.string().optional().describe('Actor id, default hermes'),
});

mcpServer.registerTool(
  'claim_task',
  {
    description: 'Claim a task for Hermes coordination',
    inputSchema: claimTaskShape,
  },
  async (args) => {
    const { task_id, claimed_by } = args as { task_id: string; claimed_by?: string };
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(task_id)}/claim`, {
        method: 'POST',
        body: JSON.stringify({ claimed_by: claimed_by ?? 'hermes' }),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const getTaskContextShape = acpInputSchema({
  task_id: z.string(),
});

mcpServer.registerTool(
  'get_task_context',
  {
    description: 'Get task context: project, task, team plan, assignments, evidence, gates, events',
    inputSchema: getTaskContextShape,
  },
  async (args) => {
    const { task_id } = args as { task_id: string };
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(task_id)}/context`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const createTeamPlanShape = acpInputSchema({
  task_id: z.string(),
  team_plan_id: z.string().optional(),
  created_by: z.string(),
  roles: z.array(z.string()),
  assignments: z.array(z.string()).optional(),
  gates: z.array(gateKind),
  status: z.enum(['draft', 'active', 'superseded', 'cancelled']).optional(),
  notes: z.string().optional(),
});

type CreateTeamPlanArgs = {
  task_id: string;
  team_plan_id?: string;
  created_by: string;
  roles: string[];
  assignments?: string[];
  gates: GateKind[];
  status?: 'draft' | 'active' | 'superseded' | 'cancelled';
  notes?: string;
};

mcpServer.registerTool(
  'create_team_plan',
  {
    description: 'Create or update team plan for a task (HTTP: POST /team-plan; when task is already team_planned, replaces plan in place)',
    inputSchema: createTeamPlanShape,
  },
  async (args) => {
    const body = args as CreateTeamPlanArgs;
    try {
      const { task_id, ...rest } = body;
      const data = await api(`/api/tasks/${encodeURIComponent(task_id)}/team-plan`, {
        method: 'POST',
        body: JSON.stringify(rest),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const createAssignmentShape = acpInputSchema({
  task_id: z.string(),
  assignment_id: z.string().optional(),
  agent_profile_id: z.string().optional(),
  role: z.enum([
    'coordinator',
    'implementer',
    'researcher',
    'reviewer',
    'tester',
    'archivist',
    'specialist',
  ]),
  instructions: z.string(),
  expected_outputs: z.array(z.string()),
  evidence_requirements: z.array(z.string()),
  status: z
    .enum(['pending', 'in_progress', 'blocked', 'done', 'failed', 'cancelled'])
    .optional(),
  blocked_reason: z.string().optional(),
});

type CreateAssignmentArgs = {
  task_id: string;
  assignment_id?: string;
  agent_profile_id?: string;
  role:
    | 'coordinator'
    | 'implementer'
    | 'researcher'
    | 'reviewer'
    | 'tester'
    | 'archivist'
    | 'specialist';
  instructions: string;
  expected_outputs: string[];
  evidence_requirements: string[];
  status?: 'pending' | 'in_progress' | 'blocked' | 'done' | 'failed' | 'cancelled';
  blocked_reason?: string;
};

mcpServer.registerTool(
  'create_assignment',
  {
    description: 'Create an assignment on a task (delegation step)',
    inputSchema: createAssignmentShape,
  },
  async (args) => {
    const body = args as CreateAssignmentArgs;
    try {
      const { task_id, ...rest } = body;
      const data = await api(`/api/tasks/${encodeURIComponent(task_id)}/assignments`, {
        method: 'POST',
        body: JSON.stringify(rest),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const updateAssignmentStatusShape = acpInputSchema({
  task_id: z.string(),
  assignment_id: z.string(),
  status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'failed', 'cancelled']),
  blocked_reason: z.string().optional(),
});

mcpServer.registerTool(
  'update_assignment_status',
  {
    description: 'PATCH assignment status (and optional blocked_reason)',
    inputSchema: updateAssignmentStatusShape,
  },
  async (args) => {
    const { task_id, assignment_id, ...patch } = args as {
      task_id: string;
      assignment_id: string;
      status: CreateAssignmentArgs['status'];
      blocked_reason?: string;
    };
    try {
      const data = await api(
        `/api/tasks/${encodeURIComponent(task_id)}/assignments/${encodeURIComponent(assignment_id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const appendCoordinationEventShape = acpInputSchema({
  task_id: z.string(),
  assignment_id: z.string().optional(),
  event_type: z.enum([
    'assigned',
    'blocked',
    'handoff_requested',
    'evidence_submitted',
    'review_requested',
    'status_changed',
    'other',
  ]),
  message: z.string(),
  actor_type: z.enum(['human', 'hermes', 'agent']),
  agent_profile_id: z.string().optional(),
});

mcpServer.registerTool(
  'append_coordination_event',
  {
    description: 'Append a coordination event for a task',
    inputSchema: appendCoordinationEventShape,
  },
  async (args) => {
    const a = args as {
      task_id: string;
      assignment_id?: string;
      event_type: string;
      message: string;
      actor_type: 'human' | 'hermes' | 'agent';
      agent_profile_id?: string;
    };
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(a.task_id)}/events`, {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: a.assignment_id,
          event_type: a.event_type,
          message: a.message,
          actor: { type: a.actor_type, agent_profile_id: a.agent_profile_id },
        }),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const createHandoffShape = acpInputSchema({
  task_id: z.string(),
  handoff_id: z.string().optional(),
  from_type: z.enum(['human', 'hermes', 'agent']),
  from_agent_profile_id: z.string().optional(),
  to_type: z.enum(['human', 'hermes', 'agent']),
  to_agent_profile_id: z.string().optional(),
  completed_work: z.array(z.string()),
  remaining_work: z.array(z.string()),
  evidence_refs: z.array(z.string()),
  risks: z.array(z.string()),
});

mcpServer.registerTool(
  'create_handoff',
  {
    description: 'Record a handoff on a task',
    inputSchema: createHandoffShape,
  },
  async (args) => {
    const a = args as {
      task_id: string;
      handoff_id?: string;
      from_type: 'human' | 'hermes' | 'agent';
      from_agent_profile_id?: string;
      to_type: 'human' | 'hermes' | 'agent';
      to_agent_profile_id?: string;
      completed_work: string[];
      remaining_work: string[];
      evidence_refs: string[];
      risks: string[];
    };
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(a.task_id)}/handoffs`, {
        method: 'POST',
        body: JSON.stringify({
          handoff_id: a.handoff_id,
          from_actor: { type: a.from_type, agent_profile_id: a.from_agent_profile_id },
          to_actor: { type: a.to_type, agent_profile_id: a.to_agent_profile_id },
          completed_work: a.completed_work,
          remaining_work: a.remaining_work,
          evidence_refs: a.evidence_refs,
          risks: a.risks,
        }),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const openEscalationShape = acpInputSchema({
  task_id: z.string(),
  escalation_id: z.string().optional(),
  category: z.enum([
    'unclear_requirements',
    'permission_denied',
    'verify_failed',
    'agent_conflict',
    'other',
  ]),
  summary: z.string(),
  options: z.array(z.string()),
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
});

mcpServer.registerTool(
  'open_escalation',
  {
    description: 'Open or record an escalation for a task',
    inputSchema: openEscalationShape,
  },
  async (args) => {
    const a = args as {
      task_id: string;
      escalation_id?: string;
      category: string;
      summary: string;
      options: string[];
      status?: 'open' | 'resolved' | 'dismissed';
    };
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(a.task_id)}/escalations`, {
        method: 'POST',
        body: JSON.stringify({
          escalation_id: a.escalation_id,
          category: a.category,
          summary: a.summary,
          options: a.options,
          status: a.status,
        }),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const submitEvidenceShape = acpInputSchema({
  task_id: z.string(),
  evidence_id: z.string().optional(),
  type: evidenceType,
  uri: z.string(),
  hash: z.string().optional(),
  created_at: z.string().optional(),
  produced_by_run_id: z.string().optional(),
});

type SubmitEvidenceArgs = {
  task_id: string;
  evidence_id?: string;
  type: EvidenceType;
  uri: string;
  hash?: string;
  created_at?: string;
  produced_by_run_id?: string;
};

mcpServer.registerTool(
  'submit_evidence',
  {
    description: 'Register evidence and link to task',
    inputSchema: submitEvidenceShape,
  },
  async (args) => {
    const body = args as SubmitEvidenceArgs;
    try {
      const { task_id, ...ev } = body;
      const data = await api(`/api/tasks/${encodeURIComponent(task_id)}/evidence`, {
        method: 'POST',
        body: JSON.stringify(ev),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

const markGateResultShape = acpInputSchema({
  task_id: z.string(),
  gate_id: z.string().describe('Stable gate instance id, e.g. gate-plan-1'),
  kind: gateKind,
  status: gateStatus,
  evidence_refs: z.array(z.string()).optional(),
  waive_reason: z.string().optional(),
  actor: z.string().optional(),
});

type MarkGateArgs = {
  task_id: string;
  gate_id: string;
  kind: GateKind;
  status: GateStatus;
  evidence_refs?: string[];
  waive_reason?: string;
  actor?: string;
};

mcpServer.registerTool(
  'mark_gate_result',
  {
    description: 'Set gate result for a task',
    inputSchema: markGateResultShape,
  },
  async (args) => {
    const { task_id, gate_id, ...rest } = args as MarkGateArgs;
    try {
      const data = await api(
        `/api/tasks/${encodeURIComponent(task_id)}/gates/${encodeURIComponent(gate_id)}/result`,
        {
          method: 'POST',
          body: JSON.stringify(rest),
        },
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return toolError(e);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
