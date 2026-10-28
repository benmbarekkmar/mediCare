import { Router } from 'express';
import type { EntityDef} from '../ontology/registry';
import { ENTITY_DEFS, ENTITY_KEYS, SPECIALTIES, DISEASE_CATEGORIES } from '../ontology/registry';
import { CLASS_LABELS, CLASS_PARENTS, ancestorChain } from '../ontology/hierarchy';
import { authenticate, can, currentUser } from '../auth/middleware';
import { writableFieldsFor } from '../http/guards';
import { asyncHandler } from '../core/http';
import { sparql } from '../sparql/client';
import { env } from '../config/env';
import { nlpClient } from '../nlp/client';

/**
 * Registry mirror for the front-end: the Angular forms, filter bars and tables
 * are generated from this descriptor instead of hard-coding the 10 entities.
 */
export const metaRouter = Router();

metaRouter.get(
  '/entities',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(
      ENTITY_KEYS.filter((key) => can(user.role, key, 'read')).map((key) => {
        const def = ENTITY_DEFS[key];
        return {
          key: def.key,
          label: def.label,
          plural: def.plural,
          classLocal: def.classLocal,
          classLabel: CLASS_LABELS[def.classLocal] ?? def.classLocal,
          idStyle: def.idStyle,
          nameField: def.nameField,
          description: def.description,
          derivedPatient: def.derivedPatient ?? false,
          data: def.data.map((d) => ({
            predicate: d.predicate,
            field: d.field,
            datatype: d.datatype,
            required: d.required ?? false,
            values: d.values ?? null,
            unique: d.unique ?? false,
            min: d.min ?? null,
            max: d.max ?? null,
            maxLength: d.maxLength ?? null,
            sortable: d.sortable ?? false,
            search: d.search ?? false,
            pattern: d.pattern ?? null,
          })),
          relations: def.relations.map((r) => ({
            predicate: r.predicate,
            inverse: r.inverse,
            target: r.target,
            targetLabel: ENTITY_DEFS[r.target].label,
            field: r.field,
            cardinality: r.cardinality,
            required: r.required ?? false,
            readOnly: r.readOnly ?? false,
            functional: r.functional ?? false,
            virtual: r.virtual ?? null,
            filterParam: r.filterParam ?? null,
          })),
          typeFacet: def.typeFacet
            ? { ...def.typeFacet }
            : null,
          filterable: [...new Set([...filterParams(def)])],
          writable: { create: can(user.role, key, 'create'), update: can(user.role, key, 'update'), delete: can(user.role, key, 'delete') },
          writableFields: writableFieldsFor(user.role, key),
        };
      }),
    );
  }),
);

const filterParams = (def: EntityDef): string[] => {
  const names = def.data.filter((d) => d.values || d.datatype === 'integer' || d.datatype === 'dateTime').map((d) => d.field);
  const rel = def.relations.filter((r) => r.filterParam).map((r) => r.filterParam as string);
  const facet = def.typeFacet?.filterParam ? [def.typeFacet.filterParam] : [];
  return [...names, ...rel, ...facet, 'q', 'page', 'pageSize', 'sort', 'order'];
};

metaRouter.get(
  '/specialties',
  authenticate,
  asyncHandler(async (_req, res) => {
    res.json({ specialties: SPECIALTIES, diseaseCategories: [...DISEASE_CATEGORIES] });
  }),
);

/** Class ancestry table so the UI can explain why an individual carries several types. */
metaRouter.get(
  '/hierarchy',
  authenticate,
  asyncHandler(async (_req, res) => {
    const roots = Object.keys(CLASS_PARENTS);
    res.json({
      ancestry: roots.map((cls) => ({ classLocal: cls, chain: ancestorChain(cls), labels: CLASS_LABELS })),
    });
  }),
);

/** Health probe used by the status strip in the layout. */
metaRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [store, nlp] = await Promise.all([sparql.ping(), nlpClient.ping()]);
    res.status(store.ok ? 200 : 503).json({
      ok: store.ok,
      tripleStore: { ok: store.ok, triples: store.triples, error: store.error, dataset: env.FUSEKI_DATASET },
      nlp: { ok: nlp.ok, error: nlp.detail },
    });
  }),
);
