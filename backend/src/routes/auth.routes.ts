import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../core/http';
import { badRequest, conflict, forbidden, unauthorized } from '../core/errors';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { users } from '../auth/user.repo';
import { tokens } from '../auth/tokens';
import { audit, listAudit } from '../auth/audit';
import type { PublicUser, Role, UserRecord } from '../auth/model';
import { ROLES, toPublicUser } from '../auth/model';
import { authenticate, currentUser, requireRoles, PERMISSIONS } from '../auth/middleware';
import { ENTITY_KEYS, GENDER_VALUES, dataFieldOf, entityDef } from '../ontology/registry';
import { entityRepo } from '../repos/entity.repo';
import { ontologyWriter } from '../ontology/writer';
import { isSafeId } from '../sparql/escape';
import { writableFieldsFor } from '../http/guards';

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(4).max(200),
});

const refreshSchema = z.object({ refreshToken: z.string().min(16).max(200) });

const passwordSchema = z
  .object({
    currentPassword: z.string().min(4).max(200),
    newPassword: z.string().min(8).max(200),
  })
  .refine((v) => /[A-Za-z]/.test(v.newPassword) && /[0-9]/.test(v.newPassword), {
    message: 'newPassword must contain letters and digits',
    path: ['newPassword'],
  });

const userSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
  fullName: z.string().min(2).max(160),
  role: z.enum(ROLES),
  linkedId: z.string().max(128).nullish(),
  locale: z.enum(['fr', 'en']).optional(),
});

const patchUserSchema = z.object({
  email: z.string().email().max(160).optional(),
  password: z.string().min(8).max(200).optional(),
  fullName: z.string().min(2).max(160).optional(),
  role: z.enum(ROLES).optional(),
  linkedId: z.string().max(128).nullish(),
  locale: z.enum(['fr', 'en']).optional(),
  active: z.boolean().optional(),
});

/**
 * Patient self-registration. The contact field keeps the exact format the
 * `patients` registry declares for `hasPhoneNumber`, so the ontology validator
 * can never reject a value the route already accepted.
 */
const phoneField = dataFieldOf(entityDef('patients'), 'phone');
const phoneSchema = z
  .string()
  .trim()
  .max(phoneField?.maxLength ?? 20)
  .regex(new RegExp(phoneField?.pattern ?? '^[0-9+ ]{6,20}$'), 'phone has an invalid format');

const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must use the YYYY-MM-DD format')
  .refine((value) => birthDateOf(value) !== null, 'birthDate is not a real calendar date')
  .refine((value) => {
    const birth = birthDateOf(value);
    return birth !== null && birth.getTime() <= Date.now();
  }, 'birthDate must not be in the future');

const registerSchema = z
  .object({
    email: z.string().trim().email().max(160),
    password: z.string().min(8).max(200),
    fullName: z.string().trim().min(2).max(160),
    birthDate: birthDateSchema,
    gender: z.enum(GENDER_VALUES),
    phone: phoneSchema.optional(),
    // the ontology has no address property; audit sanitization omits this field too
    address: z.string().trim().max(200).optional(),
    locale: z.enum(['en', 'fr']).optional(),
  })
  .refine((v) => /[A-Za-z]/.test(v.password) && /[0-9]/.test(v.password), {
    message: 'password must contain letters and digits',
    path: ['password'],
  });

const forgotSchema = z.object({ email: z.string().trim().email().max(160) });

/** Calendar-safe parse of a `YYYY-MM-DD` string: `Date` happily rolls 2026-02-31 over. */
function birthDateOf(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/** Completed years of age, the value `:hasAge` holds and the age classes derive from. */
const ageOf = (birthDate: Date, now: Date = new Date()): number => {
  const years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  return beforeBirthday ? years - 1 : years;
};

const requireBirthDate = (value: string): Date => {
  const parsed = birthDateOf(value);
  if (!parsed) throw badRequest(`Invalid birthDate "${value}"`, { violations: ['birthDate is not a date'] });
  return parsed;
};

/** Compensating action of the registration: an individual without its account is an orphan. */
async function deletePatientQuietly(patientId: string): Promise<void> {
  try {
    await ontologyWriter.remove('patients', patientId);
    logger.warn('registration rolled back, individual deleted');
  } catch {
    logger.error('registration rollback failed');
  }
}

const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body ?? {});
  if (!result.success)
    throw badRequest('Invalid request body', {
      violations: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  return result.data;
};

const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, code: 'RATE_LIMITED', message: 'Too many authentication attempts' },
});

/** Resolves the clinical individual behind an account so the UI can show a profile. */
async function linkedProfile(role: Role, linkedId: string | null) {
  if (!linkedId || !isSafeId(linkedId)) return null;
  if (role === 'PATIENT') return entityRepo.getById(entityDef('patients'), linkedId, false);
  if (role === 'DOCTOR') return entityRepo.getById(entityDef('doctors'), linkedId, false);
  return null;
}

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = users.byEmail(email);
    if (!user || !user.active || !users.verifyPassword(password, user.passwordHash)) {
      audit({ action: 'LOGIN_FAILED', status: 401, req, details: { email }, user: null });
      throw unauthorized('Wrong email or password');
    }
    users.touchLogin(user.id);
    const loggedInUser = users.byId(user.id);
    if (!loggedInUser) throw unauthorized('Account no longer exists');
    const issued = tokens.pair(loggedInUser);
    audit({ action: 'LOGIN', status: 200, req, user: loggedInUser });
    res.json({ ...issued, user: toPublicUser(loggedInUser) });
  }),
);

authRouter.post(
  '/refresh',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    const { user, next } = tokens.rotate(refreshToken);
    audit({ action: 'TOKEN_REFRESH', status: 200, req, user });
    res.json({ ...next, user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    if (body.refreshToken) tokens.revoke(String(body.refreshToken));
    audit({ action: 'LOGOUT', status: 200, req });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const account = users.byId(user.id);
    if (!account || !account.active) throw unauthorized('Account is disabled or no longer exists');
    const profile = await linkedProfile(user.role, user.linkedId);
    res.json({ user: toPublicUser(account), profile });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { currentPassword, newPassword } = parse(passwordSchema, req.body);
    const account = users.byId(user.id);
    if (!account || !users.verifyPassword(currentPassword, account.passwordHash))
      throw unauthorized('Current password is incorrect');
    users.update(user.id, { password: newPassword });
    tokens.revokeAllForUser(user.id);
    audit({ action: 'PASSWORD_CHANGE', status: 200, req, user });
    res.json({ ok: true, sessionsRevoked: true });
  }),
);

authRouter.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ sessions: tokens.activeSessions(currentUser(req).id) });
  }),
);

/**
 * Patient self-registration: the Patient individual and its PATIENT account are
 * created together, the account being linked to the individual by its local name.
 *
 * The individual goes through the ontology writer first so the declared axioms
 * hold for the graph: the class closure (`:Patient` + `owl:NamedIndividual`), the
 * `rdfs:label`, the derived age class of `:hasAge` and both directions of every
 * inverse pair. `users.create` always inserts an active row, so the account is
 * usable immediately; if that insert fails, the freshly created individual is
 * deleted again and the original error is rethrown.
 */
authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(registerSchema, req.body);
    const email = input.email.toLowerCase();
    if (users.byEmail(email)) throw conflict(`An account for ${email} already exists`);

    const def = entityDef('patients');
    const age = ageOf(requireBirthDate(input.birthDate));
    const individual = await ontologyWriter.create('patients', {
      fields: {
        [def.nameField]: input.fullName,
        age,
        gender: input.gender,
        ...(input.phone ? { phone: input.phone } : {}),
      },
      label: input.fullName,
      relations: {},
      pendingClinicalAssignment: true,
    });

    let account: UserRecord;
    try {
      account = users.create({
        email,
        password: input.password,
        role: 'PATIENT',
        fullName: input.fullName,
        linkedId: individual.id,
        locale: input.locale,
      });
    } catch (err) {
      await deletePatientQuietly(individual.id);
      throw err;
    }

    audit({
      action: 'REGISTER',
      entity: 'patients',
      resourceId: individual.id,
      status: 201,
      req,
      user: account,
      details: {
        email,
        fullName: input.fullName,
        birthDate: input.birthDate,
        gender: input.gender,
        phone: input.phone ?? null,
        address: input.address ?? null,
        locale: account.locale,
      },
    });
    const body: { account: PublicUser; patient: { id: string } } = {
      account: toPublicUser(account),
      patient: { id: individual.id },
    };
    res.status(201).json(body);
  }),
);

/**
 * Password reset request, documented stub.
 *
 * Mail delivery is out of scope for this project (no SMTP transport is wired in
 * and no new dependency is allowed), so no link is ever sent and `delivered`
 * stays false. The response body is intentionally IDENTICAL whether the address
 * is known or not, so this endpoint cannot be used to enumerate accounts; the
 * attempt is audited without a user, and only the server log records that a
 * reset link would have been produced for an existing account.
 */
authRouter.post(
  '/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email } = parse(forgotSchema, req.body);
    const normalized = email.toLowerCase();
    const account = users.byEmail(normalized);
    audit({
      action: 'PASSWORD_RESET_REQUEST',
      status: 200,
      req,
      user: null,
      details: account ? { email: normalized, accountId: account.id } : { email: normalized },
    });
    if (account)
      logger.info(
        { accountId: account.id, role: account.role },
        'forgot-password: a reset link would have been sent (no mail transport configured)',
      );
    res.json({ ok: true, delivered: false });
  }),
);

/** Account administration, ADMIN only. */
export const usersRouter = Router();

usersRouter.use(authenticate, requireRoles('ADMIN'));

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: users.list().map(toPublicUser) });
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(userSchema, req.body);
    if (input.linkedId && !isSafeId(input.linkedId)) throw badRequest(`Invalid linkedId "${input.linkedId}"`);
    if ((input.role === 'PATIENT' || input.role === 'DOCTOR') && !input.linkedId)
      throw badRequest(`${input.role} accounts must be linked to a ${input.role === 'PATIENT' ? 'Patient' : 'Doctor'} individual`);
    const created = users.create({ ...input, linkedId: input.linkedId ?? null });
    audit({ action: 'USER_CREATE', entity: 'users', resourceId: String(created.id), status: 201, req });
    res.status(201).json(toPublicUser(created));
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest('User id must be a number');
    const patch = parse(patchUserSchema, req.body);
    const target = users.byId(id);
    if (!target) throw forbidden('Unknown account');
    const updated = users.update(id, { ...patch, linkedId: patch.linkedId ?? undefined });
    if (!updated) throw forbidden(`Unknown account ${id}`);
    audit({ action: 'USER_UPDATE', entity: 'users', resourceId: String(id), status: 200, req, details: patch });
    res.json(toPublicUser(updated));
  }),
);

usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const current = currentUser(req);
    if (id === current.id) throw badRequest('You cannot delete your own account');
    users.remove(id);
    audit({ action: 'USER_DELETE', entity: 'users', resourceId: String(id), status: 200, req });
    res.json({ deleted: id });
  }),
);

export const auditRouter = Router();

auditRouter.get(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(500, Number(req.query.limit ?? 100) || 100);
    res.json({
      items: listAudit(limit, {
        action: typeof req.query.action === 'string' ? req.query.action : undefined,
        entity: typeof req.query.entity === 'string' ? req.query.entity : undefined,
      }),
    });
  }),
);

/** Exposed so the frontend can hide actions the token would reject anyway. */
export const permissionsRouter = Router();

permissionsRouter.get(
  '/matrix',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({
      role: user.role,
      permissions: PERMISSIONS[user.role],
      matrix: PERMISSIONS,
      writableFields: Object.fromEntries(
        ENTITY_KEYS.map((key) => [key, writableFieldsFor(user.role, key)]),
      ),
    });
  }),
);
