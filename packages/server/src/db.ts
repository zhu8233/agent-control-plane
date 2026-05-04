import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export const DEFAULT_DATA_DIR = '.acp/data';

export function openAcpDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'acp.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

const CHILD_SPECS: ReadonlyArray<{ table: string; idCol: string }> = [
  { table: 'assignments', idCol: 'assignment_id' },
  { table: 'evidences', idCol: 'evidence_id' },
  { table: 'handoffs', idCol: 'handoff_id' },
  { table: 'escalations', idCol: 'escalation_id' },
];

const INDEXES_V2 = `
  CREATE INDEX IF NOT EXISTS idx_assignments_task ON assignments(task_id);
  CREATE INDEX IF NOT EXISTS idx_evidences_task ON evidences(task_id);
  CREATE INDEX IF NOT EXISTS idx_gates_task ON gates(task_id);
  CREATE INDEX IF NOT EXISTS idx_events_task ON coordination_events(task_id);
  CREATE INDEX IF NOT EXISTS idx_handoffs_task ON handoffs(task_id);
  CREATE INDEX IF NOT EXISTS idx_escalations_task ON escalations(task_id);
`;

function countUserTables(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite*'`,
    )
    .get() as { c: number };
  return row.c;
}

function tableSql(db: Database.Database, name: string): string | null {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
    | { sql: string }
    | undefined;
  return row?.sql ?? null;
}

/** Legacy child: single-column global id PK. v2: PRIMARY KEY (task_id, idCol). */
function classifyLegacyChild(
  sql: string | null,
  idCol: string,
): 'missing' | 'v1' | 'v2' | 'unknown' {
  if (!sql) return 'missing';
  const s = sql.replace(/\s+/g, ' ');
  const composite = new RegExp(
    `PRIMARY KEY\\s*\\(\\s*task_id\\s*,\\s*${idCol}\\s*\\)`,
    'i',
  );
  if (composite.test(s)) return 'v2';
  const inlinePk = new RegExp(`${idCol}\\s+TEXT\\s+PRIMARY KEY`, 'i');
  if (inlinePk.test(s)) return 'v1';
  const pkOnly = new RegExp(`PRIMARY KEY\\s*\\(\\s*${idCol}\\s*\\)`, 'i');
  if (pkOnly.test(s)) return 'v1';
  if (/task_id/i.test(s) && new RegExp(idCol, 'i').test(s)) return 'unknown';
  return 'unknown';
}

function createSingleChildV2(db: Database.Database, table: string, idCol: string): void {
  db.exec(`
    CREATE TABLE ${table} (
      task_id TEXT NOT NULL,
      ${idCol} TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, ${idCol})
    );
  `);
}

function rewriteChildV1ToV2(db: Database.Database, table: string, idCol: string): void {
  db.exec(`
    ALTER TABLE ${table} RENAME TO ${table}_v1_legacy;
    CREATE TABLE ${table} (
      task_id TEXT NOT NULL,
      ${idCol} TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, ${idCol})
    );
    INSERT INTO ${table} (task_id, ${idCol}, body_json)
      SELECT task_id, ${idCol}, body_json FROM ${table}_v1_legacy;
    DROP TABLE ${table}_v1_legacy;
  `);
}

/** CREATE IF NOT EXISTS core tables (not the four child rewrite targets). */
function ensureCoreTablesV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      task_json TEXT NOT NULL,
      claimed_by TEXT
    );
    CREATE TABLE IF NOT EXISTS team_plans (
      task_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gates (
      gate_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, gate_id)
    );
    CREATE TABLE IF NOT EXISTS coordination_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
  `);
}

function upgradeChildrenToV2(db: Database.Database): void {
  for (const { table, idCol } of CHILD_SPECS) {
    const c = classifyLegacyChild(tableSql(db, table), idCol);
    if (c === 'missing') {
      createSingleChildV2(db, table, idCol);
    } else if (c === 'v1') {
      rewriteChildV1ToV2(db, table, idCol);
    } else if (c === 'v2') {
      continue;
    } else {
      throw new Error(`ACP SQLite: cannot migrate table "${table}" — unexpected DDL`);
    }
  }
  db.exec(INDEXES_V2);
}

/** Full schema at user_version 2 (composite PKs on child tables scoped by task_id). */
function createSchemaV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      task_json TEXT NOT NULL,
      claimed_by TEXT
    );
    CREATE TABLE IF NOT EXISTS team_plans (
      task_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assignments (
      task_id TEXT NOT NULL,
      assignment_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, assignment_id)
    );
    CREATE TABLE IF NOT EXISTS evidences (
      task_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, evidence_id)
    );
    CREATE TABLE IF NOT EXISTS gates (
      gate_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, gate_id)
    );
    CREATE TABLE IF NOT EXISTS coordination_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS handoffs (
      task_id TEXT NOT NULL,
      handoff_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, handoff_id)
    );
    CREATE TABLE IF NOT EXISTS escalations (
      task_id TEXT NOT NULL,
      escalation_id TEXT NOT NULL,
      body_json TEXT NOT NULL,
      PRIMARY KEY (task_id, escalation_id)
    );
    ${INDEXES_V2}
  `);
}

function migrateV1ToV2(db: Database.Database): void {
  upgradeChildrenToV2(db);
}

function migrate(db: Database.Database): void {
  const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const cur = v.user_version;
  if (cur === 2) return;
  if (cur === 1) {
    migrateV1ToV2(db);
    db.pragma('user_version = 2');
    return;
  }
  if (cur < 1) {
    if (countUserTables(db) === 0) {
      createSchemaV2(db);
      db.pragma('user_version = 2');
      return;
    }
    ensureCoreTablesV2(db);
    upgradeChildrenToV2(db);
    db.pragma('user_version = 2');
  }
}
