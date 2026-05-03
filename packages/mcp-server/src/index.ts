/**
 * @acp/mcp-server — Hermes-facing MCP tools (stdio). Calls @acp/server HTTP API.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
/** MCP SDK types target Zod v3; the default `zod` entry may resolve to v4 in this monorepo. */
import { z } from 'zod/v3';
const baseUrl = process.env.ACP_SERVER_URL ?? 'http://127.0.0.1:3840';

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
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
    throw new Error(`ACP HTTP ${r.status} ${path}: ${text}`);
  }
  return parsed;
}

function toolError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
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
  version: '0.1.0',
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

const claimTaskShape: ZodRawShapeCompat = {
  task_id: z.string().describe('ACP task id'),
  claimed_by: z.string().optional().describe('Actor id, default hermes'),
};

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

const getTaskContextShape: ZodRawShapeCompat = {
  task_id: z.string(),
};

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

const createTeamPlanShape: ZodRawShapeCompat = {
  task_id: z.string(),
  team_plan_id: z.string().optional(),
  created_by: z.string(),
  roles: z.array(z.string()),
  assignments: z.array(z.string()).optional(),
  gates: z.array(gateKind),
  status: z.enum(['draft', 'active', 'superseded', 'cancelled']).optional(),
  notes: z.string().optional(),
};

/** Mirrors `createTeamPlanShape` for handler typing without deep generic expansion. */
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
    description: 'Create or replace team plan for a task',
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

const submitEvidenceShape: ZodRawShapeCompat = {
  task_id: z.string(),
  evidence_id: z.string().optional(),
  type: evidenceType,
  uri: z.string(),
  hash: z.string().optional(),
  created_at: z.string().optional(),
  produced_by_run_id: z.string().optional(),
};

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

const markGateResultShape: ZodRawShapeCompat = {
  task_id: z.string(),
  gate_id: z.string().describe('Stable gate instance id, e.g. gate-plan-1'),
  kind: gateKind,
  status: gateStatus,
  evidence_refs: z.array(z.string()).optional(),
  waive_reason: z.string().optional(),
  actor: z.string().optional(),
};

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
