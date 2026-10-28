import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/http';
import { authenticate, requireRoles } from '../auth/middleware';
import { sparql } from '../sparql/client';
import { badRequest } from '../core/errors';
import { guardReadQuery, guardUpdateStatement, readForm, splitUpdate } from '../services/query-guard';
import { audit } from '../auth/audit';
import { logger } from '../config/logger';

const MAX_LIMIT = 500;

const READ_TYPES = ['select', 'ask', 'construct', 'describe'] as const;
const UPDATE_TYPES = ['insert', 'delete', 'deleteinsert', 'update'] as const;

const querySchema = z.object({
  query: z.string().trim().min(6, 'Empty query'),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

const updateSchema = z.object({
  update: z.string().trim().min(10, 'Empty update'),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Set "confirm": true to execute a store update' }) }),
});

const validationMessage = (error: z.ZodError): string =>
  error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

/** Guarded read execution shared by the console and the documented /api/sparql endpoint. */
async function runRead(raw: string, limit: number, req: Request): Promise<Record<string, unknown>> {
  const query = sparql.prepare(guardReadQuery(raw, limit));
  audit({ action: 'SPARQL_QUERY', entity: 'sparql', resourceId: null, req, details: { query } });
  const form = readForm(query);
  if (form === 'construct') {
    const graph = await sparql.construct(query);
    return { form, ntriples: graph.ntriples, executionMs: graph.executionMs, query };
  }
  if (form === 'ask') {
    const started = Date.now();
    const answer = await sparql.ask(query);
    return { form, answer, executionMs: Date.now() - started, query };
  }
  const result = await sparql.select(query);
  return { form, ...result, query };
}

/** Guarded write execution: the only place raw triples may reach the store. */
async function runUpdate(raw: string, req: Request): Promise<Record<string, unknown>> {
  const update = sparql.prepare(guardUpdateStatement(raw));
  const operations = splitUpdate(update);
  logger.warn({ operations: operations.length }, 'manual SPARQL update');
  const stats = await sparql.update(update);
  audit({
    action: 'SPARQL_UPDATE',
    entity: 'sparql',
    resourceId: null,
    status: 200,
    req,
    details: { operations, update },
  });
  return { ...stats, operations, triples: await sparql.countTriples() };
}

export const consoleRouter = Router();

consoleRouter.use(authenticate, requireRoles('ADMIN'));

/** Read-only SPARQL console. The gate refuses update forms and remote SERVICE calls. */
consoleRouter.post(
  '/query',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(validationMessage(parsed.error));
    res.json(await runRead(parsed.data.query, parsed.data.limit ?? 100, req));
  }),
);

/**
 * Explicit SPARQL Update escape hatch for the administrator. It is the only
 * route allowed to write raw triples, and it requires an explicit confirmation
 * flag plus an audit entry; the ontology writer remains the normal path.
 */
consoleRouter.post(
  '/update',
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(validationMessage(parsed.error));
    res.json(await runUpdate(parsed.data.update, req));
  }),
);

const sparqlSchema = z.object({
  query: z.string().trim().min(6, 'Empty query'),
  type: z.string().trim().min(1).max(24),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  confirm: z.boolean().optional(),
});

/**
 * Documented single entry point `POST /api/sparql { query, type }`: the type
 * decides whether the statement goes through the read guard or the update
 * escape hatch, which still demands an explicit confirmation flag.
 */
export const sparqlRouter = Router();

sparqlRouter.use(authenticate, requireRoles('ADMIN'));

sparqlRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = sparqlSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(validationMessage(parsed.error));

    const type = parsed.data.type.toLowerCase();
    if ((READ_TYPES as readonly string[]).includes(type)) {
      res.json({ type, ...(await runRead(parsed.data.query, parsed.data.limit ?? 100, req)) });
      return;
    }
    if (!(UPDATE_TYPES as readonly string[]).includes(type))
      throw badRequest(`Unknown statement type "${type}". Allowed: ${[...READ_TYPES, ...UPDATE_TYPES].join(', ')}`);
    if (parsed.data.confirm !== true)
      throw badRequest('Set "confirm": true to execute a store update', {
        violations: ['A write statement must be confirmed explicitly'],
      });
    res.json({ type, ...(await runUpdate(parsed.data.query, req)) });
  }),
);
