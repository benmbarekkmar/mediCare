import { Router } from 'express';
import { asyncHandler } from '../core/http';
import { authenticate } from '../auth/middleware';
import { ontologyService } from '../services/ontology.service';
import { badRequest, notFound } from '../core/errors';
import { isSafeId } from '../sparql/escape';
import { entityRepo } from '../repos/entity.repo';
import { ENTITY_DEFS, ENTITY_KEYS } from '../ontology/registry';

export const ontologyRouter = Router();

ontologyRouter.use(authenticate);

/** TBox/ABox census straight from the store: class, property, individual and axiom counts. */
ontologyRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json(await ontologyService.stats());
  }),
);

/** rdfs:subClassOf tree with the number of individuals asserted under each class. */
ontologyRouter.get(
  '/hierarchy',
  asyncHandler(async (_req, res) => {
    res.json({ classes: await ontologyService.hierarchy(), static: ontologyService.staticHierarchy() });
  }),
);

/** Documented alias used by the explorer tree. */
ontologyRouter.get(
  '/classes',
  asyncHandler(async (_req, res) => {
    res.json({ classes: await ontologyService.hierarchy(), static: ontologyService.staticHierarchy() });
  }),
);

/** ABox listing for one class: GET /api/ontology/individuals?class=Cardiologist */
ontologyRouter.get(
  '/individuals',
  asyncHandler(async (req, res) => {
    const cls = typeof req.query.class === 'string' ? req.query.class : '';
    if (!cls) throw badRequest('The class parameter is required, e.g. ?class=Patient');
    const limit = Number(req.query.limit ?? 200);
    if (!Number.isFinite(limit)) throw badRequest('Invalid limit');
    res.json(await ontologyService.individuals(cls, limit));
  }),
);

/** Object/datatype/annotation properties, their domain, range, inverses, characteristics and chains. */
ontologyRouter.get(
  '/properties',
  asyncHandler(async (_req, res) => {
    res.json(await ontologyService.properties());
  }),
);

/** Individual neighbourhood used by the graph view: ?focus=<id>&depth=<1..3> */
ontologyRouter.get(
  '/graph',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 160);
    if (!Number.isFinite(limit)) throw badRequest('Invalid limit');
    const focus = typeof req.query.focus === 'string' ? req.query.focus.trim() : '';
    if (!focus) {
      res.json(await ontologyService.graph(limit));
      return;
    }
    const depth = Number(req.query.depth ?? 2);
    if (!Number.isFinite(depth)) throw badRequest('Invalid depth');
    res.json(await ontologyService.neighbourhood(focus, depth, limit));
  }),
);

/** All asserted triples of one individual, outgoing and incoming. */
ontologyRouter.get(
  '/individuals/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isSafeId(id)) throw notFound(`Invalid identifier "${id}"`);
    const exists = await Promise.all(ENTITY_KEYS.map((key) => entityRepo.exists(id, ENTITY_DEFS[key])));
    if (!exists.some(Boolean)) throw notFound(`No individual ${id} in the store`);
    res.json(await ontologyService.individualGraph(id));
  }),
);
