import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import type { ValidateFunction, ErrorObject } from 'ajv';

const addFormats = addFormatsImport as unknown as (ajv: InstanceType<typeof Ajv2020>) => void;

let validateTeamPlan: ValidateFunction | undefined;
let validateAssignmentCreate: ValidateFunction | undefined;
let validateAssignmentPatch: ValidateFunction | undefined;
let validateEvidence: ValidateFunction | undefined;
let validateGate: ValidateFunction | undefined;
let validateCoordinationEvent: ValidateFunction | undefined;
let validateHandoff: ValidateFunction | undefined;
let validateEscalation: ValidateFunction | undefined;
let validateClaimPost: ValidateFunction | undefined;

function compileRelaxed(
  a: InstanceType<typeof Ajv2020>,
  repoRoot: string,
  name: string,
  omitRequired: string[],
): ValidateFunction {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'protocol', 'schemas', name), 'utf8'),
  ) as { $id?: string; required?: string[] };
  const base =
    (raw.$id ?? `https://agent-control-plane.local/schemas/${name}`).split('#')[0] ?? '';
  const slug = omitRequired.join('_');
  const compiled = {
    ...raw,
    $id: `${base.replace(/\.json$/i, '')}.relaxed-${slug}.json`,
    required: (raw.required ?? []).filter((r) => !omitRequired.includes(r)),
  };
  return a.compile(compiled);
}

/** Fresh AJV instance per call so integration tests can spawn multiple servers safely. */
export function initProtocolValidators(repoRoot: string): void {
  const a = new Ajv2020({ allErrors: true, strict: false });
  addFormats(a);
  const schemaDir = join(repoRoot, 'packages', 'protocol', 'schemas');
  for (const fname of readdirSync(schemaDir).filter((f) => f.endsWith('.json')).sort()) {
    const schema = JSON.parse(readFileSync(join(schemaDir, fname), 'utf8')) as object;
    a.addSchema(schema);
  }

  validateTeamPlan = a.getSchema('https://agent-control-plane.local/schemas/acp-team-plan.schema.json');
  if (!validateTeamPlan) throw new Error('ACP schema missing: acp-team-plan');

  const assignmentRaw = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'protocol', 'schemas', 'acp-assignment.schema.json'), 'utf8'),
  ) as {
    $id?: string;
    required?: string[];
    properties?: Record<string, unknown>;
  };

  const assignmentCreate = {
    ...assignmentRaw,
    $id: 'https://agent-control-plane.local/schemas/acp-assignment.http-create.json',
    required: (assignmentRaw.required ?? []).filter((r) => r !== 'assignment_id'),
  };
  validateAssignmentCreate = a.compile(assignmentCreate);

  const assignmentPatch = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agent-control-plane.local/schemas/acp-assignment-patch.json',
    type: 'object',
    required: ['status'],
    properties: {
      status: assignmentRaw.properties?.status,
      blocked_reason: assignmentRaw.properties?.blocked_reason,
    },
    additionalProperties: false,
  };
  validateAssignmentPatch = a.compile(assignmentPatch);

  validateEvidence = a.getSchema('https://agent-control-plane.local/schemas/acp-evidence.schema.json');
  if (!validateEvidence) throw new Error('ACP schema missing: acp-evidence');

  validateGate = a.getSchema('https://agent-control-plane.local/schemas/acp-gate.schema.json');
  if (!validateGate) throw new Error('ACP schema missing: acp-gate');

  validateCoordinationEvent = compileRelaxed(
    a,
    repoRoot,
    'acp-coordination-event.schema.json',
    ['coordination_event_id', 'created_at'],
  );

  validateHandoff = compileRelaxed(a, repoRoot, 'acp-handoff.schema.json', ['handoff_id']);

  validateEscalation = compileRelaxed(a, repoRoot, 'acp-escalation.schema.json', ['escalation_id']);

  validateClaimPost = a.getSchema('https://agent-control-plane.local/schemas/acp-claim-post.schema.json');
  if (!validateClaimPost) throw new Error('ACP schema missing: acp-claim-post');
}

export type ValidationFailure = { ok: false; errors: ErrorObject[] | null | undefined };
export type ValidationSuccess = { ok: true };

/** Resolved actor id for POST /claim (trimmed); use when validation succeeded. */
export type ClaimPostResolved =
  | { ok: true; claimed_by: string }
  | ValidationFailure;

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

export function assertAssignmentPatch(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateAssignmentPatch, data);
}

export function assertEvidence(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateEvidence, data);
}

export function assertGate(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateGate, data);
}

export function assertCoordinationEventCreate(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateCoordinationEvent, data);
}

export function assertHandoffCreate(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateHandoff, data);
}

export function assertEscalationCreate(data: unknown): ValidationSuccess | ValidationFailure {
  return run(validateEscalation, data);
}

/**
 * POST /api/tasks/:id/claim body: optional missing claimed_by → hermes; otherwise non-empty string after trim.
 */
export function resolveClaimPostBody(body: unknown): ClaimPostResolved {
  if (body === null) {
    return {
      ok: false,
      errors: [{ message: 'claim body must not be JSON null', instancePath: '' } as ErrorObject],
    };
  }
  const empty = body === undefined;
  const rec =
    empty ? {} : body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (rec === null) {
    return {
      ok: false,
      errors: [{ message: 'claim body must be a JSON object', instancePath: '' } as ErrorObject],
    };
  }
  const sch = run(validateClaimPost, rec);
  if (!sch.ok) return sch;
  if (rec.claimed_by === undefined) return { ok: true, claimed_by: 'hermes' };
  const trimmed = String(rec.claimed_by).trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      errors: [{ message: 'claimed_by must be non-empty after trim', instancePath: '/claimed_by' } as ErrorObject],
    };
  }
  return { ok: true, claimed_by: trimmed };
}
