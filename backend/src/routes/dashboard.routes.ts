import { Router } from 'express';
import { asyncHandler } from '../core/http';
import { authenticate, requireRoles } from '../auth/middleware';
import { dashboardService } from '../services/dashboard.service';
import { consistencyService } from '../services/consistency.service';
import { audit } from '../auth/audit';

export const dashboardRouter = Router();

/**
 * Aggregate statistics for the back-office and professional dashboards. The
 * upcoming appointment list carries patient names, so a PATIENT account is not
 * served here: the portal reads its own scoped record instead.
 */
dashboardRouter.get(
  '/',
  authenticate,
  requireRoles('ADMIN', 'DOCTOR', 'RECEPTIONIST'),
  asyncHandler(async (_req, res) => {
    res.json(await dashboardService.build());
  }),
);

/** Materialization audit: proves the superclass closure, inverse pairs and
 *  derived classes the ontology would infer are actually present in the store. */
export const consistencyRouter = Router();

consistencyRouter.get(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await consistencyService.audit());
  }),
);

consistencyRouter.post(
  '/repair',
  authenticate,
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const result = await consistencyService.repair();
    audit({ action: 'CONSISTENCY_REPAIR', entity: 'ontology', resourceId: '*', status: 200, req, details: result });
    res.json(result);
  }),
);
