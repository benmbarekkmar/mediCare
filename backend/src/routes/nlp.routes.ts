import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/http';
import { authenticate, requireRoles, type AuthUser } from '../auth/middleware';
import type { NlpParse } from '../nlp/client';
import { nlpClient } from '../nlp/client';
import { guardForPatient, ownPatientFilter } from '../nlp/policy';
import { sparql } from '../sparql/client';
import { prefixes } from '../sparql/prefixes';
import { badRequest, forbidden } from '../core/errors';
import { guardReadQuery, readForm } from '../services/query-guard';
import { iriToken } from '../sparql/escape';
import { audit } from '../auth/audit';
import { logger } from '../config/logger';

const MAX_ROWS = 200;

export const nlpRouter = Router();

nlpRouter.use(authenticate);

const askSchema = z.object({
  question: z.string().trim().min(3, 'Ask a longer question').max(400),
  locale: z.enum(['en', 'fr']).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ROWS).optional(),
});

const parseBody = (body: unknown) => {
  const parsed = askSchema.safeParse(body);
  if (!parsed.success)
    throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
};

/**
 * Natural language question -> NLP service -> validated SPARQL -> Fuseki.
 * The generated query always passes the read-only gate, and the role policy here
 * is what decides whose records may appear: the Python service is trusted for
 * language, never for authorisation.
 */
nlpRouter.post(
  '/ask',
  requireRoles('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'),
  asyncHandler(async (req, res) => {
    const user = req.user as AuthUser;
    const input = parseBody(req.body);
    const plan = await buildPlan(input, user);
    enforceRole(plan, user);

    const answer = plan.sparql
      ? await execute(plan.sparql, user)
      : { sparql: '', columns: [], rows: [] as Record<string, string>[], executionMs: 0 };

    logger.info({ intent: plan.intent, role: user.role, ms: answer.executionMs }, 'nlp answer');
    audit({
      action: 'NLP_ASK',
      entity: 'nlp',
      resourceId: plan.intent,
      status: 200,
      req,
      details: { question: plan.question, sparql: answer.sparql, confidence: plan.confidence },
    });
    res.json({
      parse: plan,
      sparql: answer.sparql,
      columns: answer.columns,
      rows: answer.rows,
      executionMs: answer.executionMs,
    });
  }),
);

/** Show the generated SPARQL without touching the store (question preview). */
nlpRouter.post(
  '/preview',
  requireRoles('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'),
  asyncHandler(async (req, res) => {
    const user = req.user as AuthUser;
    const plan = await buildPlan(parseBody(req.body), user);
    enforceRole(plan, user);
    const sparqlText = plan.sparql ? finalQuery(plan.sparql) : '';
    res.json({ parse: plan, sparql: sparqlText, columns: [], rows: [], executionMs: 0 });
  }),
);

nlpRouter.get(
  '/health',
  requireRoles('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.health());
  }),
);

/** The intent catalogue is documentation, every role may read it. */
nlpRouter.get(
  '/intents',
  requireRoles('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.intents());
  }),
);

nlpRouter.get(
  '/vocabulary',
  requireRoles('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.vocabulary());
  }),
);

/** Offline evaluation report: intent accuracy, entity linking accuracy, per-test cases. */
nlpRouter.get(
  '/evaluation',
  requireRoles('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.evaluation());
  }),
);

/** Rebuilds the ontology vocabulary and refits the classifier after an ontology change. */
nlpRouter.post(
  '/reload',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const report = await nlpClient.reload();
    audit({ action: 'NLP_RELOAD', entity: 'nlp', status: 200, req });
    res.json(report);
  }),
);

async function buildPlan(
  input: { question: string; locale?: 'en' | 'fr'; limit?: number },
  user: AuthUser,
): Promise<NlpParse> {
  const own = user.role === 'PATIENT' ? patientSlot(user) : undefined;
  return nlpClient.ask({ ...input, ownPatient: own });
}

/** A patient account must be linked to a Patient individual to ask about records. */
function patientSlot(user: AuthUser): string {
  if (!user.linkedId) throw forbidden('This account is not linked to a patient record');
  if (!/^Patient_[A-Za-z0-9_]+$/.test(user.linkedId))
    throw forbidden('This account is not linked to a patient record');
  return user.linkedId;
}

function enforceRole(plan: NlpParse, user: AuthUser): void {
  if (user.role !== 'PATIENT') return;
  guardForPatient(plan, user.linkedId);
}

interface Answer {
  sparql: string;
  columns: string[];
  rows: Record<string, string>[];
  executionMs: number;
}

/** Read-only gate plus the prefix declarations the generated query lacks. */
function finalQuery(generated: string): string {
  const guarded = guardReadQuery(generated, MAX_ROWS);
  // the service already declares its prefixes, only the missing ones are added
  return `${prefixes.missingIn(guarded)}\n${guarded}`.trim();
}

async function execute(generated: string, user: AuthUser): Promise<Answer> {
  const query = finalQuery(generated);

  if (readForm(query) === 'ask') {
    const truth = await sparql.ask(query);
    return { sparql: query, columns: ['answer'], rows: [{ answer: String(truth) }], executionMs: 0 };
  }
  if (readForm(query) === 'construct') {
    const graph = await sparql.construct(query);
    const rows = graph.ntriples
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((triple) => ({ triple }));
    return { sparql: query, columns: ['triple'], rows, executionMs: graph.executionMs };
  }
  const result = await sparql.select(query);
  let rows = result.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, term] of Object.entries(row)) out[key] = term?.value ?? '';
    return out;
  });
  if (user.role === 'DOCTOR') rows = await scopeToOwnPatients(rows, user);
  return { sparql: query, columns: result.vars, rows, executionMs: result.executionMs };
}

/**
 * A doctor may only see records of the patients they follow: the answer rows are
 * filtered against the `treatedBy` closure of their own doctor individual.
 */
async function scopeToOwnPatients(
  rows: Record<string, string>[],
  user: AuthUser,
): Promise<Record<string, string>[]> {
  if (!user.linkedId) throw forbidden('This account is not linked to a doctor record');
  const doctor = iriToken(user.linkedId);
  const query = prefixes.withPrefixes(
    `SELECT ?p WHERE { ?p ont:treatedBy ${doctor} } LIMIT ${MAX_ROWS}`,
  );
  const owned = await sparql.select(query);
  const locals = new Set(
    owned.rows
      .map((row) => row.p?.value ?? '')
      .filter(Boolean)
      .map((iri) => String(iri).slice(String(iri).indexOf('#') + 1)),
  );
  return ownPatientFilter(locals)(rows);
}
