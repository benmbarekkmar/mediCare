import request from 'supertest';
import type { Role } from '../../src/auth/model';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { db } from '../../src/db/sqlite';
import { users } from '../../src/auth/user.repo';
import { DEMO } from '../../scripts/demo-accounts';

/** Application under test: one Express instance, no network listener. */
let cached: ReturnType<typeof createApp> | null = null;
const appInstance = (): ReturnType<typeof createApp> => {
  if (!cached) cached = createApp();
  return cached;
};
export const api = () => request(appInstance());

export interface Session {
  email: string;
  role: Role;
  linkedId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  accessToken: string;
  refreshToken: string;
}

const PASSWORD = env.SEED_DEMO_PASSWORD;

/**
 * Empties the audit, token and account tables and recreates the demo accounts.
 * Rows are deleted rather than the file unlinked: Windows keeps a closed WAL
 * handle locked for a moment and `rmSync` would fail the whole suite.
 */
export function resetSqlite(): void {
  const store = db();
  store.pragma('foreign_keys = OFF');
  for (const table of ['audit_log', 'refresh_tokens', 'users']) store.prepare(`DELETE FROM ${table}`).run();
  store.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('users', 'audit_log')`).run();
  store.pragma('foreign_keys = ON');
  for (const account of DEMO)
    users.create({
      email: account.email,
      password: PASSWORD,
      role: account.role,
      fullName: account.fullName,
      linkedId: account.linkedId ?? null,
      locale: account.locale,
    });
}

const EMAIL_BY_ROLE: Record<Role, string> = {
  ADMIN: 'admin@medicare.tn',
  RECEPTIONIST: 'reception@medicare.tn',
  DOCTOR: 'salma.benali@medicare.tn',
  PATIENT: 'ahmed@medicare.tn',
};

export async function login(role: Role, email = EMAIL_BY_ROLE[role]): Promise<Session> {
  const res = await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  const body = res.body as { accessToken: string; refreshToken: string; user: Session };
  return {
    email,
    role: body.user.role,
    linkedId: body.user.linkedId ?? null,
    createdAt: body.user.createdAt,
    lastLoginAt: body.user.lastLoginAt,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

/** supertest agent that sends the access token on every request. */
export const asSession = (session: Session) =>
  request.agent(appInstance()).set('Authorization', `Bearer ${session.accessToken}`);

export const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
