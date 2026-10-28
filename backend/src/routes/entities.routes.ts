import { Router } from 'express';
import { asyncHandler } from '../core/http';
import { notFound } from '../core/errors';
import type { EntityKey} from '../ontology/registry';
import { entityDef, ENTITY_KEYS } from '../ontology/registry';
import { entityRepo } from '../repos/entity.repo';
import { ontologyWriter } from '../ontology/writer';
import { findDependents } from '../ontology/validator';
import { audit } from '../auth/audit';
import { authenticate, type AuthUser, currentUser, requirePermission, requireRoles } from '../auth/middleware';
import { assertInScope, assertWritableFields } from '../http/guards';
import { entityKeyOf, parseEntityBody, reassignToOf } from '../http/body';
import type { NormalizedInput } from '../ontology/writer';
import { pageEnvelope, parseListQuery } from '../http/query';

const assertId = (value: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value ?? '')) throw notFound(`Invalid identifier "${value}"`);
  return value;
};

/** a patient may only ever book or touch their own clinical records */
const forceOwnPatientLink = (
  role: string,
  linkedId: string | null,
  key: EntityKey,
  input: NormalizedInput,
  isCreate: boolean,
): void => {
  if (role !== 'PATIENT' || !linkedId) return;
  if (key === 'appointments' || key === 'tests')
    input.relations = { ...(input.relations ?? {}), patient: [linkedId] };
  // a patient requests a visit; confirming it stays a back-office action
  if (isCreate && key === 'appointments') input.fields = { status: 'Pending', ...input.fields };
};

/** a doctor may only attach a record to a patient they follow */
const assertLinkedPatientScope = async (
  user: AuthUser,
  key: EntityKey,
  relations: Record<string, string[] | null> | null | undefined,
): Promise<void> => {
  if (user.role !== 'DOCTOR' || (key !== 'tests' && key !== 'appointments')) return;
  for (const patientId of relations?.patient ?? [])
    await assertInScope(user, entityDef('patients'), patientId, 'create');
};

const crud = (key: EntityKey): Router => {
  const def = entityDef(key);
  const router = Router();

  router.get(
    '/',
    authenticate,
    requirePermission(key, 'read'),
    asyncHandler(async (req, res) => {
      const query = parseListQuery(def, req, currentUser(req));
      const { items, total } = await entityRepo.list(def, query);
      res.json(pageEnvelope(items, total, query));
    }),
  );

  router.get(
    '/refs',
    authenticate,
    requirePermission(key, 'read'),
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const limit = Math.min(200, Number(req.query.limit ?? 20) || 20);
      res.json(await entityRepo.refs(def, limit, q));
    }),
  );

  router.get(
    '/:id',
    authenticate,
    requirePermission(key, 'read'),
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = assertId(String(req.params.id));
      const item = await entityRepo.getById(def, id);
      if (!item) throw notFound(`${def.label} ${id} does not exist`);
      await assertInScope(user, def, id, 'read');
      res.json(item);
    }),
  );

  router.post(
    '/',
    authenticate,
    requirePermission(key, 'create'),
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const input = parseEntityBody(def, req.body);
      assertWritableFields(user, def, input);
      forceOwnPatientLink(user.role, user.linkedId, key, input, true);
      await assertLinkedPatientScope(user, key, input.relations);
      const created = await ontologyWriter.create(key, input);
      audit({ action: 'CREATE', entity: key, resourceId: created.id, status: 201, req, details: input });
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    authenticate,
    requirePermission(key, 'update'),
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = assertId(String(req.params.id));
      await assertInScope(user, def, id, 'update');
      const input = parseEntityBody(def, req.body);
      assertWritableFields(user, def, input);
      forceOwnPatientLink(user.role, user.linkedId, key, input, false);
      await assertLinkedPatientScope(user, key, input.relations);
      const updated = await ontologyWriter.update(key, id, input);
      audit({ action: 'UPDATE', entity: key, resourceId: id, status: 200, req, details: input });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    authenticate,
    requirePermission(key, 'delete'),
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = assertId(String(req.params.id));
      await assertInScope(user, def, id, 'delete');
      const result = await ontologyWriter.remove(key, id, { reassignTo: reassignToOf(req.body) });
      audit({ action: 'DELETE', entity: key, resourceId: id, status: 200, req, details: result });
      res.json({ ...result, label: def.label });
    }),
  );

  return router;
};

/** What would break if this individual disappeared, shown before a destructive confirmation. */
const dependentsRouter = Router();

dependentsRouter.get(
  '/:entity/:id/dependents',
  authenticate,
  requireRoles('ADMIN', 'RECEPTIONIST'),
  asyncHandler(async (req, res) => {
    const key = entityKeyOf(String(req.params.entity));
    const def = entityDef(key);
    const id = assertId(String(req.params.id));
    if (!(await entityRepo.exists(id, def))) throw notFound(`${def.label} ${id} does not exist`);
    res.json({ entity: key, id, dependents: await findDependents(def, id) });
  }),
);

/** One mounted router per entity: /api/patients, /api/doctors, ... */
export const entitiesRouter = Router();

entitiesRouter.use('/', dependentsRouter);
for (const key of ENTITY_KEYS) entitiesRouter.use(`/${key}`, crud(key));
