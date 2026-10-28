import type { Request } from 'express';
import type { EntityDef } from '../ontology/registry';
import type { ListQuery } from '../repos/entity.repo';
import { buildFilters, buildScope } from '../repos/filters';
import type { AuthUser } from '../auth/middleware';
import { badRequest } from '../core/errors';

export const MAX_PAGE_SIZE = 100;

const str = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value);
};

/** Raw query parameters as a flat string map, used by the SPARQL filter builder. */
export const rawParams = (req: Request): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.query)) out[key] = str(value);
  return out;
};

export function parseListQuery(def: EntityDef, req: Request, user: AuthUser): ListQuery {
  const params = rawParams(req);
  const page = positiveInt(params.page, 'page', 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, positiveInt(params.pageSize, 'pageSize', 20));
  const sort = params.sort?.trim();
  const order = params.order?.trim().toLowerCase();
  if (order && order !== 'asc' && order !== 'desc') throw badRequest(`Invalid order "${order}", expected asc or desc`);

  const sortable = new Set<string>(['label', ...def.data.filter((d) => d.sortable).map((d) => d.field)]);
  if (sort && !sortable.has(sort))
    throw badRequest(`Cannot sort ${def.plural.toLowerCase()} by "${sort}". Allowed: ${[...sortable].join(', ')}`);

  const q = params.q?.trim();
  if (q && q.length > 120) throw badRequest('Search term is too long (max 120 characters)');

  return {
    page,
    pageSize,
    sort,
    order: (order as 'asc' | 'desc' | undefined) ?? 'asc',
    q,
    extraFilters: buildFilters(def, params),
    scope: scopeOf(def, user),
  };
}

/** Scope is injected separately because it needs the caller's linked individual. */
export function scopeOf(def: EntityDef, user: AuthUser): string {
  const kind = user.role === 'PATIENT' ? 'ownPatient' : user.role === 'DOCTOR' ? 'treatingDoctor' : 'none';
  if (kind === 'none') return '';
  if (!user.linkedId) return 'FILTER(false)';
  return buildScope(def, kind, user.linkedId);
}

const positiveInt = (raw: string | undefined, name: string, fallback: number): number => {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${name}: ${raw}`);
  return n;
};

export const pageEnvelope = <T>(
  items: T[],
  total: number,
  query: ListQuery,
): {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: string | null;
  order: 'asc' | 'desc';
  q: string | null;
} => ({
  items,
  page: query.page,
  pageSize: query.pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  sort: query.sort ?? null,
  order: query.order ?? 'asc',
  q: query.q ?? null,
});
