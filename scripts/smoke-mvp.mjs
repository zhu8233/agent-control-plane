/**
 * MVP smoke: starts built server, runs HTTP steps matching MCP tool workflow, exits 0 on success.
 * Run from repo root after `npm run build -w @acp/server`.
 *
 * This exercises the **HTTP API** only (same URLs the MCP server calls). It does not
 * spawn an MCP stdio client. Prefer script name `smoke:http`; `smoke:mcp` is a legacy alias.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceFileUri = pathToFileURL(join(root, 'README.md')).href;
const serverEntry = join(root, 'packages', 'server', 'dist', 'index.js');
const port = process.env.SMOKE_PORT ?? '3841';
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'acp-smoke-'));

async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

const child = spawn(process.execPath, [serverEntry], {
  env: {
    ...process.env,
    ACP_REPO_ROOT: root,
    ACP_DATA_DIR: dataDir,
    PORT: port,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr?.on('data', (c) => {
  stderr += String(c);
});

try {
  await waitHealth();
  const tid = 'example-task-001';

  let r = await fetch(`${base}/api/tasks/${tid}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimed_by: 'smoke' }),
  });
  if (!r.ok) throw new Error(`claim ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/team-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      created_by: 'smoke',
      roles: ['implementer', 'reviewer'],
      gates: ['plan_ready', 'verify_done', 'review_done', 'archive_done'],
    }),
  });
  if (!r.ok) throw new Error(`team-plan ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'implementer',
      instructions: 'Implement MVP',
      expected_outputs: ['code'],
      evidence_requirements: ['log'],
    }),
  });
  if (!r.ok) throw new Error(`assignment ${r.status} ${await r.text()}`);
  const assignBody = await r.json();
  const aid = assignBody.assignment.assignment_id;

  r = await fetch(`${base}/api/tasks/${tid}/assignments/${aid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress' }),
  });
  if (!r.ok) throw new Error(`assignment patch ip ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/assignments/${aid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  if (!r.ok) throw new Error(`assignment patch done ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'log', uri: evidenceFileUri }),
  });
  if (!r.ok) throw new Error(`evidence ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'other',
      message: 'smoke event',
      actor: { type: 'hermes' },
    }),
  });
  if (!r.ok) throw new Error(`event ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/handoffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_actor: { type: 'agent', agent_profile_id: 'a1' },
      to_actor: { type: 'agent', agent_profile_id: 'a2' },
      completed_work: ['x'],
      remaining_work: ['y'],
      evidence_refs: [],
      risks: [],
    }),
  });
  if (!r.ok) throw new Error(`handoff ${r.status} ${await r.text()}`);

  r = await fetch(`${base}/api/tasks/${tid}/escalations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: 'other',
      summary: 'none',
      options: ['ignore'],
    }),
  });
  if (!r.ok) throw new Error(`escalation ${r.status} ${await r.text()}`);

  for (const [gid, kind] of [
    ['g-verify', 'verify_done'],
    ['g-review', 'review_done'],
    ['g-archive', 'archive_done'],
  ]) {
    r = await fetch(`${base}/api/tasks/${tid}/gates/${gid}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, status: 'passed', actor: 'smoke' }),
    });
    if (!r.ok) throw new Error(`gate ${gid} ${r.status} ${await r.text()}`);
  }

  r = await fetch(`${base}/api/tasks/${tid}/context`);
  const ctx = await r.json();
  if (!ctx.ok) throw new Error('context not ok');
  if (ctx.task.status !== 'completed') {
    throw new Error(`expected task completed, got ${ctx.task.status}`);
  }
  console.log('smoke OK (HTTP API — same routes as MCP tools; not MCP stdio)');
} catch (e) {
  console.error(e);
  console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dataDir, { recursive: true, force: true });
}
