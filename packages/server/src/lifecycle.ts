/**
 * Task lifecycle: legal status transitions for MVP (409 on illegal jumps).
 */
export const TASK_STATUSES = [
  'intake',
  'context_bind',
  'claimed',
  'team_planned',
  'delegated',
  'coordinating',
  'executing',
  'verifying',
  'reviewing',
  'archiving',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Allowed next statuses from each current status. */
const ALLOWED: Record<TaskStatus, Set<TaskStatus>> = {
  intake: new Set(['context_bind', 'claimed', 'cancelled']),
  context_bind: new Set(['claimed', 'cancelled']),
  claimed: new Set(['team_planned', 'cancelled']),
  team_planned: new Set(['delegated', 'coordinating', 'cancelled']),
  delegated: new Set(['coordinating', 'executing', 'cancelled']),
  coordinating: new Set(['executing', 'verifying', 'cancelled']),
  executing: new Set(['verifying', 'failed', 'cancelled']),
  verifying: new Set(['reviewing', 'failed', 'cancelled']),
  reviewing: new Set(['archiving', 'cancelled']),
  archiving: new Set(['completed', 'failed', 'cancelled']),
  completed: new Set([]),
  failed: new Set(['cancelled']),
  cancelled: new Set([]),
};

export function isTaskStatus(v: string): v is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(v);
}

export function assertTaskTransition(from: string, to: string): { ok: true } | { error: string } {
  if (!isTaskStatus(from) || !isTaskStatus(to)) {
    return { error: `invalid_status:${from}->${to}` };
  }
  if (!ALLOWED[from].has(to)) {
    return { error: `illegal_transition:${from}->${to}` };
  }
  return { ok: true };
}

const ASSIGNMENT_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'done',
  'failed',
  'cancelled',
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

const ASSIGNMENT_ALLOWED: Record<AssignmentStatus, Set<AssignmentStatus>> = {
  pending: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['blocked', 'done', 'failed', 'cancelled']),
  blocked: new Set(['in_progress', 'cancelled']),
  done: new Set([]),
  failed: new Set([]),
  cancelled: new Set([]),
};

export function isAssignmentStatus(v: string): v is AssignmentStatus {
  return (ASSIGNMENT_STATUSES as readonly string[]).includes(v);
}

export function assertAssignmentTransition(
  from: string,
  to: string,
): { ok: true } | { error: string } {
  if (!isAssignmentStatus(from) || !isAssignmentStatus(to)) {
    return { error: `invalid_assignment_status:${from}->${to}` };
  }
  if (!ASSIGNMENT_ALLOWED[from].has(to)) {
    return { error: `illegal_assignment_transition:${from}->${to}` };
  }
  return { ok: true };
}

/** Task states where creating another assignment is allowed (MVP multi-agent). */
const ASSIGNMENT_CREATE_ALLOWED = new Set<TaskStatus>(['team_planned', 'delegated', 'coordinating']);

export function assertCanCreateAssignment(
  taskStatus: string,
): { ok: true } | { error: string } {
  if (!isTaskStatus(taskStatus)) {
    return { error: `invalid_status_for_assignment:${taskStatus}` };
  }
  if (!ASSIGNMENT_CREATE_ALLOWED.has(taskStatus)) {
    return { error: `cannot_create_assignment_in_status:${taskStatus}` };
  }
  return { ok: true };
}
