import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/http';
import { authenticate, currentUser } from '../auth/middleware';
import { searchService } from '../services/search.service';
import type { EntityKey } from '../ontology/registry';
import { ENTITY_KEYS } from '../ontology/registry';
import { badRequest } from '../core/errors';
import { rawParams } from '../http/query';

const schema = z.object({
  q: z.string().trim().min(1, 'Search term is required').max(120),
  entities: z.string().optional(),
  perEntity: z.coerce.number().int().min(1).max(25).optional(),
});

export const searchRouter = Router();

/**
 * Global search bar: one SPARQL query per entity group, matching on labels,
 * skos:altLabel synonyms and searchable data properties, with the same role
 * scoping as the list endpoints.
 */
searchRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success)
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));

    const keys = parseEntities(parsed.data.entities);
    const filters = rawParams(req);
    res.json(await searchService.search(parsed.data.q, currentUser(req), keys, parsed.data.perEntity ?? 5, filters));
  }),
);

const parseEntities = (raw: string | undefined): EntityKey[] => {
  if (!raw) return ENTITY_KEYS;
  const keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = keys.filter((k) => !(ENTITY_KEYS as readonly string[]).includes(k));
  if (invalid.length) throw badRequest(`Unknown entity: ${invalid.join(', ')}. Allowed: ${ENTITY_KEYS.join(', ')}`);
  return keys as EntityKey[];
};
