import type { Request } from 'express';
import { db, nowIso } from '../db/sqlite';
import { logger } from '../config/logger';
import type { Role } from './model';

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_CHANGE'
  | 'REGISTER'
  | 'PASSWORD_RESET_REQUEST'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SPARQL_QUERY'
  | 'SPARQL_UPDATE'
  | 'CONSISTENCY_REPAIR'
  | 'ONTOLOGY_LOAD'
  | 'NLP_ASK'
  | 'NLP_RELOAD';

export interface AuditEntry {
  id: number;
  userId: number | null;
  email: string | null;
  role: Role | null;
  action: AuditAction;
  entity: string | null;
  resourceId: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  details: string | null;
  createdAt: string;
}

const INSERT = `INSERT INTO audit_log
  (user_id, email, role, action, entity, resource_id, method, path, status, details, created_at)
  VALUES (@userId, @email, @role, @action, @entity, @resourceId, @method, @path, @status, @details, @createdAt)`;

export interface AuditInput {
  action: AuditAction;
  entity?: string | null;
  resourceId?: string | null;
  status?: number | null;
  details?: unknown;
  req?: Request;
  user?: { id: number; email: string; role: Role } | null;
}

/** Writes the audit trail (SQLite); failures never break the request. */
export function audit(input: AuditInput): void {
  const user = input.user ?? input.req?.user ?? null;
  const req = input.req;
  try {
    db()
      .prepare(INSERT)
      .run({
        userId: user?.id ?? null,
        email: user?.role === 'PATIENT' ? null : (user?.email ?? null),
        role: user?.role ?? null,
        action: input.action,
        entity: input.entity ?? null,
        resourceId: input.entity === 'patients' ? null : (input.resourceId ?? null),
        method: req?.method ?? null,
        path: req?.originalUrl
          ? req.originalUrl.split('?')[0]?.replace(/(\/api\/patients)\/[^/?]+/gi, '$1/:id') ?? null
          : null,
        status: input.status ?? null,
        details: shouldOmitDetails(input) || input.details === undefined ? null : JSON.stringify(sanitize(input.details)),
        createdAt: nowIso(),
      });
  } catch {
    logger.error({ action: input.action }, 'audit write failed');
  }
}

const REDACTED = new Set([
  'password', 'currentpassword', 'newpassword', 'token', 'refreshtoken', 'passwordhash',
  'patient', 'patients', 'patientid', 'patientiri', 'email', 'name', 'fullname', 'label',
  'linkedid', 'query', 'update', 'sparql', 'question',
]);

function shouldOmitDetails(input: AuditInput): boolean {
  return (
    input.entity === 'patients' ||
    input.action === 'NLP_ASK' ||
    input.action === 'SPARQL_QUERY' ||
    input.action === 'SPARQL_UPDATE' ||
    input.action === 'CONSISTENCY_REPAIR'
  );
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>))
      out[key] = REDACTED.has(key.toLowerCase()) ? '[redacted]' : sanitize(v);
    return out;
  }
  if (typeof value === 'string') return value.replace(/(?:https?:\/\/[^\s<>#]+#)?Patient_[A-Za-z0-9_]+/g, '[redacted]');
  return value;
}

export function listAudit(limit = 100, filters: { action?: string; entity?: string; userId?: number } = {}): AuditEntry[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: Math.min(500, Math.max(1, limit)) };
  if (filters.action) {
    where.push('action = @action');
    params.action = filters.action;
  }
  if (filters.entity) {
    where.push('entity = @entity');
    params.entity = filters.entity;
  }
  if (filters.userId) {
    where.push('user_id = @userId');
    params.userId = filters.userId;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db()
    .prepare(
      `SELECT * FROM audit_log ${clause} ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`,
    )
    .all(params) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    userId: (r.user_id as number | null) ?? null,
    email: (r.email as string | null) ?? null,
    role: (r.role as Role | null) ?? null,
    action: String(r.action) as AuditAction,
    entity: (r.entity as string | null) ?? null,
    resourceId: (r.resource_id as string | null) ?? null,
    method: (r.method as string | null) ?? null,
    path: (r.path as string | null) ?? null,
    status: (r.status as number | null) ?? null,
    details: (r.details as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}
