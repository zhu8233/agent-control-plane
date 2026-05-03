import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import type { ValidateFunction, ErrorObject } from 'ajv';

const addFormats = addFormatsImport as unknown as (ajv: InstanceType<typeof Ajv2020>) => void;

const __dirname = dirname(fileURLToPath(import.meta.url));

let ajv: InstanceType<typeof Ajv2020> | undefined;
let validateTeamPlan: ValidateFunction | undefined;
let validateAssignmentCreate: ValidateFunction | undefined;
let validateEvidence: ValidateFunction | undefined;
let validateGate: ValidateFunction | undefined;

function loadAjv(repoRoot: string): InstanceType<typeof Ajv2020> {
  if (ajv) return ajv;
  const instance = new Ajv2020({ allErrors: true, strict: false });
  addFormats(instance);
  const schemaDir = join(repoRoot, 'packages', 'protocol', 'schemas');
  for (const name of readdirSync(schemaDir).filter((f) => f.endsWith('.json')).sort()) {
    const schema = JSON.parse(readFileSync(join(schemaDir, name), 'utf8')) as object;
    instance.addSchema(schema);
  }
  ajv = instance;
  return instance;
}

export function initProtocolValidators(repoRoot: string): void {
  const a = loadAjv(repoRoot);
  validateTeamPlan = a.getSchema('https://agent-control-plane.local/schemas/acp-team-plan.schema.json');
  if (!validateTeamPlan) throw new Error('ACP schema missing: acp-team-plan');

  const assignmentRaw = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'protocol', 'schemas', 'acp-assignment.schema.json'), 'utf8'),
  ) as { $id?: string; required?: string[] };
  const assignmentCreate = {
    ...assignmentRaw,
    $id: `${assignmentRaw.$id ?? 'acp-assignment'}#http-create`,
    required: (assignmentRaw.required ?? []).filter((r) => r !== 'assignment_id'),
  };
  validateAssignmentCreate = a.compile(assignmentCreate);

  validateEvidence = a.getSchema('https://agent-control-plane.local/schemas/acp-evidence.schema.json');
  if (!validateEvidence) throw new Error('ACP schema missing: acp-evidence');

  validateGate = a.getSchema('https://agent-control-plane.local/schemas/acp-gate.schema.json');
  if (!validateGate) throw new Error('ACP schema missing: acp-gate');
}

export type ValidationFailure = { ok: false; errors: ErrorObject[] | null | undefined };
export type ValidationSuccess = { ok: true };

function run(v: ValidateFunction | undefined, data: unknown): ValidationSuccess | ValidationFailure {
  if (!v) throw new Error('call initProtocolValidators before validate');
  if (v(data)) return { ok: true };
  return { ok: false, errors: v.errors };
}

export function assertTeamPlan(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateTeamPlan, data);
}

export function assertAssignmentCreate(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateAssignmentCreate, data);
}

export function assertEvidence(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateEvidence, data);
}

export function assertGate(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateGate, data);
}
