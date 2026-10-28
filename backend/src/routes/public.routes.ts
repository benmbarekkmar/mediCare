import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../core/http';
import { badRequest, notFound } from '../core/errors';
import type { EntityKey } from '../ontology/registry';
import { ENTITY_DEFS } from '../ontology/registry';
import { entityRepo, type ListQuery } from '../repos/entity.repo';
import { buildFilters } from '../repos/filters';
import { assertSafeId, isSafeId } from '../sparql/escape';
import { optionalAuth } from '../auth/middleware';
import { rawParams, MAX_PAGE_SIZE } from '../http/query';

/**
 * Reference knowledge published without an account: the public pages browse the
 * disease/symptom/treatment catalogue and the hospital directory through the
 * same SPARQL repository as the authenticated views, scoped to read-only.
 */
export const REFERENCE_KEYS: EntityKey[] = [
  'diseases',
  'symptoms',
  'treatments',
  'medications',
  'hospitals',
  'departments',
  'doctors',
];

export const publicRouter = Router();

const assertKey = (raw: string): EntityKey => {
  if (!(REFERENCE_KEYS as string[]).includes(raw))
    throw badRequest(`Only these catalogues are public: ${REFERENCE_KEYS.join(', ')}`);
  return raw as EntityKey;
};

const publicQuery = (key: EntityKey, req: Request): ListQuery => {
  const def = ENTITY_DEFS[key];
  const params = rawParams(req);
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Number(params.pageSize ?? 12) || 12);
  const sort = params.sort?.trim();
  const order = params.order?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  if (sort && sort !== 'label' && !def.data.some((d) => d.sortable && d.field === sort))
    throw badRequest(`Cannot sort ${def.plural} by "${sort}"`);
  return {
    page,
    pageSize,
    sort,
    order,
    q: params.q?.trim().slice(0, 120),
    extraFilters: buildFilters(def, params),
    scope: '',
  };
};

publicRouter.get(
  '/:entity',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const key = assertKey(String(req.params.entity));
    const def = ENTITY_DEFS[key];
    const query = publicQuery(key, req);
    const { items, total } = await entityRepo.list(def, query);
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      sort: query.sort ?? null,
      order: query.order,
      q: query.q ?? null,
    });
  }),
);

publicRouter.get(
  '/:entity/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const key = assertKey(String(req.params.entity));
    const def = ENTITY_DEFS[key];
    const id = String(req.params.id);
    if (!isSafeId(id)) throw notFound(`Invalid identifier "${id}"`);
    const item = await entityRepo.getById(def, assertSafeId(id));
    if (!item) throw notFound(`${def.label} ${id} does not exist`);
    res.json(item);
  }),
);
