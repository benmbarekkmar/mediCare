import type { NextFunction, Request, Response } from 'express';
import type { EntityKey } from '../ontology/registry';
import { forbidden, unauthorized } from '../core/errors';
import type { Role, UserRecord } from './model';
import { users } from './user.repo';
import { tokens } from './tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** The claims the whole request pipeline relies on. */
export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  fullName: string;
  linkedId: string | null;
  locale: string;
}

export const toAuthUser = (user: UserRecord): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  fullName: user.fullName,
  linkedId: user.linkedId,
  locale: user.locale,
});

export type Action = 'read' | 'create' | 'update' | 'delete';

const READ_ONLY: EntityKey[] = [
  'symptoms',
  'treatments',
  'medications',
  'hospitals',
  'departments',
  'diseases',
  'doctors',
];

type Permissions = Partial<Record<EntityKey, Action[]>>;

const ALL: Action[] = ['read', 'create', 'update', 'delete'];
const READ_WRITE: Action[] = ['read', 'create', 'update'];
const READ: Action[] = ['read'];

/**
 * Role based access control. Every entity an API surface exposes is listed here,
 * so a new role can never inherit an accidental permission.
 */
export const PERMISSIONS: Record<Role, Permissions> = {
  ADMIN: Object.fromEntries(
    [...READ_ONLY, 'patients', 'tests', 'appointments'].map((k) => [k, ALL]),
  ) as Permissions,
  DOCTOR: {
    // medical info only: WRITABLE_FIELDS narrows which patient fields a doctor may touch
    patients: ['read', 'update'],
    appointments: ['read', 'create', 'update'],
    tests: ['read', 'create', 'update'],
    diseases: READ,
    doctors: READ,
    symptoms: READ,
    treatments: READ,
    medications: READ,
    hospitals: READ,
    departments: READ,
  },
  RECEPTIONIST: {
    // no delete: a patient record is removed by the admin only
    patients: READ_WRITE,
    appointments: ALL,
    // clinical knowledge stays out of reach, diseases are readable because the
    // Patient subclass axiom (∃hasDisease.Disease) makes one mandatory on create
    diseases: READ,
    doctors: READ,
    hospitals: READ,
    departments: READ,
  },
  PATIENT: {
    patients: ['read', 'update'],
    appointments: ['read', 'create', 'update'],
    tests: READ,
    diseases: READ,
    // the directory is public browsing, the patient's own scoping is narrower
    doctors: READ,
    symptoms: READ,
    treatments: READ,
    medications: READ,
    hospitals: READ,
    departments: READ,
  },
};

export const can = (role: Role, entity: EntityKey, action: Action): boolean =>
  (PERMISSIONS[role][entity] ?? []).includes(action);

const bearer = (req: Request): string | null => {
  const header = req.headers.authorization ?? '';
  const [scheme, value] = header.split(' ');
  if (!/^Bearer$/i.test(scheme ?? '') || !value) return null;
  return value.trim();
};

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const raw = bearer(req);
  if (!raw) {
    next(unauthorized('Missing bearer token'));
    return;
  }
  try {
    const claims = tokens.verifyAccess(raw);
    // re-read the account so deactivation and role changes apply immediately
    const account = users.byId(claims.sub);
    if (!account || !account.active) {
      next(unauthorized('Account is disabled or no longer exists'));
      return;
    }
    req.user = toAuthUser(account);
    next();
  } catch (err) {
    next(err);
  }
};

export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const raw = bearer(req);
  if (!raw) {
    next();
    return;
  }
  try {
    const account = users.byId(tokens.verifyAccess(raw).sub);
    if (account?.active) req.user = toAuthUser(account);
  } catch {
    /* anonymous access stays anonymous */
  }
  next();
};

export const requireRoles =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden(`This endpoint requires one of: ${roles.join(', ')}`));
      return;
    }
    next();
  };

export const requirePermission =
  (entity: EntityKey, action: Action) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!can(req.user.role, entity, action))
      next(forbidden(`Role ${req.user.role} may not ${action} ${entity}`));
    else next();
  };

export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw unauthorized();
  return req.user;
};
