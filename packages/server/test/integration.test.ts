import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { checkEvidenceUri } from '../src/evidence-uri.ts';
import { buildServer } from '../src/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

/** Minimal legacy schema (user_version 1) for migration coverage — matches pre-v2 child PKs. */
function createLegacyV1EmptySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY,
      task_json TEXT NOT NULL,
      claimed_by TEXT
    );
    CREATE TABLE team_plans (
      task_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL
    );
    CREATE TABLE assignments (
      assignment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
    CREATE TABLE evidences (
      evidence_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
    CREATE TABLE gates (
      gate_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, gate_id)
    );
    CREATE TABLE coordination_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE TABLE handoffs (
      handoff_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
    CREATE TABLE escalations (
      escalation_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
  `);
}

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'acp-int-'));
}

async function listen(app: FastifyInstance): Promise<{ base: string; close: () => Promise<void> }> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    close: async () => {
      await app.close();
    },
  };
}

before(() => {
  process.env.ACP_REPO_ROOT = repoRoot;
});

test('GET /api/health', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app = await buildServer();
  const { base, close } = await listen(app);
  try {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as { ok: boolean };
    assert.equal(j.ok, true);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed + claim workflow + validation 400', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app = await buildServer();
  const { base, close } = await listen(app);
  try {
    const list = await fetch(`${base}/api/tasks`);
    const lj = (await list.json()) as { tasks: Array<{ task_id: string }> };
    assert.ok(lj.tasks.some((t) => t.task_id === 'example-task-001'));

    const badPlan = await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(badPlan.status, 400);

    const claim = await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'test' }),
    });
    assert.equal(claim.status, 200);

    const plan = await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'test',
        roles: ['implementer'],
        gates: ['plan_ready'],
      }),
    });
    assert.equal(plan.status, 200);

    const badClaim2 = await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'x' }),
    });
    assert.equal(badClaim2.status, 409);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assignment patch illegal transition 409', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app = await buildServer();
  const { base, close } = await listen(app);
  try {
    await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 't' }),
    });
    await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 't',
        roles: ['implementer'],
        gates: ['plan_ready'],
      }),
    });
    const create = await fetch(`${base}/api/tasks/example-task-001/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'implementer',
        instructions: 'do',
        expected_outputs: ['x'],
        evidence_requirements: ['e'],
      }),
    });
    assert.equal(create.status, 200);
    const cj = (await create.json()) as { assignment: { assignment_id: string } };
    const aid = cj.assignment.assignment_id;

    const bad = await fetch(`${base}/api/tasks/example-task-001/assignments/${aid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    assert.equal(bad.status, 409);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two assignments after team plan and second team plan update', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app = await buildServer();
  const { base, close } = await listen(app);
  try {
    await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'multi' }),
    });

    const plan1 = await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'multi',
        roles: ['implementer'],
        gates: ['plan_ready'],
        notes: 'v1',
      }),
    });
    assert.equal(plan1.status, 200);

    const plan2 = await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'multi',
        roles: ['implementer', 'reviewer'],
        gates: ['plan_ready', 'verify_done'],
        notes: 'v2',
      }),
    });
    assert.equal(plan2.status, 200);
    const p2j = (await plan2.json()) as { team_plan: { notes?: string; gates?: string[] } };
    assert.equal(p2j.team_plan.notes, 'v2');
    assert.ok((p2j.team_plan.gates as string[]).includes('verify_done'));

    const a1 = await fetch(`${base}/api/tasks/example-task-001/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'implementer',
        instructions: 'one',
        expected_outputs: ['o1'],
        evidence_requirements: ['e1'],
      }),
    });
    assert.equal(a1.status, 200);
    const a1j = (await a1.json()) as { assignment: { assignment_id: string } };
    const id1 = a1j.assignment.assignment_id;

    const a2 = await fetch(`${base}/api/tasks/example-task-001/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'reviewer',
        instructions: 'two',
        expected_outputs: ['o2'],
        evidence_requirements: ['e2'],
      }),
    });
    assert.equal(a2.status, 200);
    const a2j = (await a2.json()) as { assignment: { assignment_id: string } };
    const id2 = a2j.assignment.assignment_id;
    assert.notEqual(id1, id2);

    const ctx = await fetch(`${base}/api/tasks/example-task-001/context`);
    const cj = (await ctx.json()) as {
      assignments: Array<{ assignment_id: string }>;
      task: { assignments?: string[]; status?: string };
    };
    assert.equal(cj.assignments.length, 2);
    assert.equal(cj.task.status, 'delegated');
    assert.ok((cj.task.assignments ?? []).includes(id1));
    assert.ok((cj.task.assignments ?? []).includes(id2));
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claim POST invalid claimed_by returns 400', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app = await buildServer();
  const { base, close } = await listen(app);
  try {
    for (const body of [
      JSON.stringify({ claimed_by: {} }),
      JSON.stringify({ claimed_by: null }),
      JSON.stringify({ claimed_by: [] }),
      JSON.stringify({ claimed_by: '' }),
      JSON.stringify({ claimed_by: '   ' }),
      JSON.stringify([]),
      JSON.stringify(null),
      JSON.stringify({ claimed_by: 'x', extra: 1 }),
    ]) {
      const r = await fetch(`${base}/api/tasks/example-task-001/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(r.status, 400, `expected 400 for body ${body}`);
    }

    const ok = await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(ok.status, 200);
    const ok2 = await fetch(`${base}/api/tasks/example-task-002/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: '  trimmed  ' }),
    });
    assert.equal(ok2.status, 404);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hydration skips corrupt assignment row by default', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  delete process.env.ACP_STRICT_HYDRATE;
  let app = await buildServer();
  let { base, close } = await listen(app);
  try {
    await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'c' }),
    });
    await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'c',
        roles: ['implementer'],
        gates: ['plan_ready'],
      }),
    });
    const create = await fetch(`${base}/api/tasks/example-task-001/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'implementer',
        instructions: 'x',
        expected_outputs: ['o'],
        evidence_requirements: ['e'],
      }),
    });
    assert.equal(create.status, 200);
  } finally {
    await close();
  }

  const sqlite = join(dir, 'acp.sqlite');
  assert.ok(existsSync(sqlite));
  const raw = new Database(sqlite);
  raw.prepare(`UPDATE assignments SET body_json = '{' WHERE task_id = ?`).run('example-task-001');
  raw.close();

  app = await buildServer();
  ({ base, close } = await listen(app));
  try {
    const ctx = await fetch(`${base}/api/tasks/example-task-001/context`);
    assert.equal(ctx.status, 200);
    const cj = (await ctx.json()) as { assignments: unknown[] };
    assert.equal(cj.assignments.length, 0);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ACP_STRICT_HYDRATE fails startup on corrupt child row', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  process.env.ACP_STRICT_HYDRATE = '1';
  try {
    const app = await buildServer();
    const { base, close } = await listen(app);
    try {
      await fetch(`${base}/api/tasks/example-task-001/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimed_by: 's' }),
      });
      await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          created_by: 's',
          roles: ['implementer'],
          gates: ['plan_ready'],
        }),
      });
      const create = await fetch(`${base}/api/tasks/example-task-001/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'implementer',
          instructions: 'x',
          expected_outputs: ['o'],
          evidence_requirements: ['e'],
        }),
      });
      assert.equal(create.status, 200);
    } finally {
      await close();
    }

    const sqlite = join(dir, 'acp.sqlite');
    const raw = new Database(sqlite);
    raw.prepare(`UPDATE assignments SET body_json = '{' WHERE task_id = ?`).run('example-task-001');
    raw.close();

    await assert.rejects(async () => buildServer(), /assignment corrupt|\[acp\]/i);
  } finally {
    delete process.env.ACP_STRICT_HYDRATE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('user_version 1 database migrates to composite child primary keys', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const file = join(dir, 'acp.sqlite');
  const raw = new Database(file);
  createLegacyV1EmptySchema(raw);
  raw
    .prepare(`INSERT INTO tasks (task_id, task_json, claimed_by) VALUES (?, ?, NULL)`)
    .run(
      'example-task-001',
      JSON.stringify({
        task_id: 'example-task-001',
        status: 'intake',
        assignments: [],
        gates: [],
        evidence_refs: [],
      }),
    );
  raw
    .prepare(`INSERT INTO assignments (assignment_id, task_id, body_json) VALUES (?,?,?)`)
    .run('a1', 'example-task-001', JSON.stringify({ assignment_id: 'a1', task_id: 'example-task-001' }));
  raw.pragma('user_version = 1');
  assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
  raw.close();

  const app = await buildServer();
  await app.close();

  const raw2 = new Database(file);
  assert.equal((raw2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
  const n = (raw2.prepare(`SELECT COUNT(*) AS c FROM assignments`).get() as { c: number }).c;
  assert.equal(n, 1);
  raw2.close();
  rmSync(dir, { recursive: true, force: true });
});

test('user_version 0 database with v1 child rows migrates like v1', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const file = join(dir, 'acp.sqlite');
  const raw = new Database(file);
  createLegacyV1EmptySchema(raw);
  raw
    .prepare(`INSERT INTO tasks (task_id, task_json, claimed_by) VALUES (?, ?, NULL)`)
    .run(
      'example-task-001',
      JSON.stringify({
        task_id: 'example-task-001',
        status: 'intake',
        assignments: [],
        gates: [],
        evidence_refs: [],
      }),
    );
  raw
    .prepare(`INSERT INTO assignments (assignment_id, task_id, body_json) VALUES (?,?,?)`)
    .run('a1', 'example-task-001', JSON.stringify({ assignment_id: 'a1', task_id: 'example-task-001' }));
  raw.pragma('user_version = 0');
  assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 0);
  raw.close();

  const app = await buildServer();
  await app.close();

  const raw2 = new Database(file);
  assert.equal((raw2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
  const sql = raw2.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='assignments'`).get() as {
    sql: string;
  };
  assert.ok(/PRIMARY KEY \(task_id, assignment_id\)/i.test(sql.sql));
  const n = (raw2.prepare(`SELECT COUNT(*) AS c FROM assignments`).get() as { c: number }).c;
  assert.equal(n, 1);
  raw2.close();
  rmSync(dir, { recursive: true, force: true });
});

test('user_version 0 with already v2 schema only bumps user_version', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app1 = await buildServer();
  await app1.close();
  const file = join(dir, 'acp.sqlite');
  const raw = new Database(file);
  const taskCount = (raw.prepare(`SELECT COUNT(*) AS c FROM tasks`).get() as { c: number }).c;
  raw.pragma('user_version = 0');
  raw.close();

  const app2 = await buildServer();
  await app2.close();

  const raw2 = new Database(file);
  assert.equal((raw2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
  assert.equal((raw2.prepare(`SELECT COUNT(*) AS c FROM tasks`).get() as { c: number }).c, taskCount);
  raw2.close();
  rmSync(dir, { recursive: true, force: true });
});

test('user_version 0 partial v1 child set creates missing v2 tables', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const file = join(dir, 'acp.sqlite');
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY,
      task_json TEXT NOT NULL,
      claimed_by TEXT
    );
    CREATE TABLE assignments (
      assignment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
  `);
  raw.pragma('user_version = 0');
  raw.close();

  const app = await buildServer();
  await app.close();

  const raw2 = new Database(file);
  assert.equal((raw2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
  const hand = raw2
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='handoffs'`)
    .get() as { sql: string };
  assert.ok(hand && /PRIMARY KEY \(task_id, handoff_id\)/i.test(hand.sql));
  raw2.close();
  rmSync(dir, { recursive: true, force: true });
});

test('same assignment_id on two different tasks is allowed', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const sharedId = 'shared-assignment-id';
  let app = await buildServer();
  let { base, close } = await listen(app);
  try {
    await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'u' }),
    });
    await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'u',
        roles: ['implementer'],
        gates: ['plan_ready'],
      }),
    });
    const c1 = await fetch(`${base}/api/tasks/example-task-001/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment_id: sharedId,
        role: 'implementer',
        instructions: 'one',
        expected_outputs: ['o'],
        evidence_requirements: ['e'],
      }),
    });
    assert.equal(c1.status, 200);
  } finally {
    await close();
  }

  const file = join(dir, 'acp.sqlite');
  const raw = new Database(file);
  raw
    .prepare(`INSERT INTO tasks (task_id, task_json, claimed_by) VALUES (?, ?, NULL)`)
    .run(
      'example-task-002',
      JSON.stringify({
        task_id: 'example-task-002',
        status: 'intake',
        assignments: [],
        gates: [],
        evidence_refs: [],
      }),
    );
  raw.close();

  app = await buildServer();
  ({ base, close } = await listen(app));
  try {
    const claim2 = await fetch(`${base}/api/tasks/example-task-002/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'u2' }),
    });
    assert.equal(claim2.status, 200);
    await fetch(`${base}/api/tasks/example-task-002/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'u2',
        roles: ['implementer'],
        gates: ['plan_ready'],
      }),
    });
    const c2 = await fetch(`${base}/api/tasks/example-task-002/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment_id: sharedId,
        role: 'reviewer',
        instructions: 'two',
        expected_outputs: ['o'],
        evidence_requirements: ['e'],
      }),
    });
    assert.equal(c2.status, 200, await c2.text());

    const ctx1 = await fetch(`${base}/api/tasks/example-task-001/context`);
    const ctx2 = await fetch(`${base}/api/tasks/example-task-002/context`);
    const j1 = (await ctx1.json()) as { assignments: Array<{ assignment_id: string }> };
    const j2 = (await ctx2.json()) as { assignments: Array<{ assignment_id: string }> };
    assert.equal(j1.assignments[0]?.assignment_id, sharedId);
    assert.equal(j2.assignments[0]?.assignment_id, sharedId);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence POST rejects disallowed URI', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  const app = await buildServer();
  const { base, close } = await listen(app);
  try {
    await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'ev' }),
    });
    await fetch(`${base}/api/tasks/example-task-001/team-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        created_by: 'ev',
        roles: ['implementer'],
        gates: ['plan_ready'],
      }),
    });

    const bad = await fetch(`${base}/api/tasks/example-task-001/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'log', uri: 'file:///C:/Windows/explorer.exe' }),
    });
    assert.equal(bad.status, 400);
    const bad2 = await fetch(`${base}/api/tasks/example-task-001/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'log', uri: 'ftp://example.com/x' }),
    });
    assert.equal(bad2.status, 400);

    const ok = await fetch(`${base}/api/tasks/example-task-001/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'summary',
        uri: pathToFileURL(join(repoRoot, 'README.md')).href,
      }),
    });
    assert.equal(ok.status, 200);

    const missing = await fetch(`${base}/api/tasks/example-task-001/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'log',
        uri: pathToFileURL(join(repoRoot, 'nonexistent-acp-evidence-test.txt')).href,
      }),
    });
    assert.equal(missing.status, 400);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkEvidenceUri rejects missing file under repo', () => {
  const r = checkEvidenceUri(pathToFileURL(join(repoRoot, 'no-such-file-acp.txt')).href, repoRoot);
  assert.equal(r, 'file_not_found');
});

test('checkEvidenceUri rejects UNC file targets on Windows', () => {
  if (process.platform !== 'win32') return;
  const r = checkEvidenceUri('file://smb-host/share/evil.txt', repoRoot);
  assert.equal(r, 'file_outside_repo');
});

test('ACP_API_TOKEN enforces Bearer on /api except health', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  process.env.ACP_API_TOKEN = 'test-secret-token';
  try {
    const app = await buildServer();
    const { base, close } = await listen(app);
    try {
      const h = await fetch(`${base}/api/health`);
      assert.equal(h.status, 200);
      const denied = await fetch(`${base}/api/tasks`);
      assert.equal(denied.status, 401);
      const ok = await fetch(`${base}/api/tasks`, {
        headers: { Authorization: 'Bearer test-secret-token' },
      });
      assert.equal(ok.status, 200);
    } finally {
      await close();
    }
  } finally {
    delete process.env.ACP_API_TOKEN;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persistence across server restart', async () => {
  const dir = tmpDataDir();
  process.env.ACP_DATA_DIR = dir;
  let app = await buildServer();
  let { base, close } = await listen(app);
  try {
    const claim = await fetch(`${base}/api/tasks/example-task-001/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: 'persist' }),
    });
    assert.equal(claim.status, 200);
  } finally {
    await close();
  }

  assert.ok(existsSync(join(dir, 'acp.sqlite')));

  app = await buildServer();
  ({ base, close } = await listen(app));
  try {
    const ctx = await fetch(`${base}/api/tasks/example-task-001/context`);
    const cj = (await ctx.json()) as { ok?: boolean; claimed_by?: string; task: { status?: string } };
    assert.equal(cj.claimed_by, 'persist');
    assert.equal(cj.task.status, 'claimed');
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

after(() => {
  delete process.env.ACP_DATA_DIR;
  delete process.env.ACP_STRICT_HYDRATE;
  delete process.env.ACP_API_TOKEN;
});
