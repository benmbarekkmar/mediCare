import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, nowIso } from '../db/sqlite';
import { env } from '../config/env';
import { unauthorized } from '../core/errors';
import type { AccessPayload, UserRecord } from './model';
import { users } from './user.repo';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RefreshRow {
  id: string;
  user_id: number;
  family: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

const hash = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

const INSERT_REFRESH = `INSERT INTO refresh_tokens (id, user_id, family, token_hash, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?)`;

export class TokenService {
  signAccess(user: UserRecord): string {
    const payload: AccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      linkedId: user.linkedId,
    };
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESS_TTL_MINUTES}m` });
  }

  verifyAccess(token: string): AccessPayload {
    let decoded: unknown;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Access token is invalid or expired');
    }
    const payload = decoded as Partial<AccessPayload>;
    if (typeof payload.sub !== 'number' || typeof payload.role !== 'string') {
      throw unauthorized('Access token payload is malformed');
    }
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role as AccessPayload['role'],
      linkedId: payload.linkedId ?? null,
    };
  }

  /** Opaque refresh token; only its hash is stored, rotation uses the family to detect reuse. */
  issueRefresh(userId: number, family?: string): { token: string; id: string } {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    const usedFamily = family ?? crypto.randomUUID();
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86400000).toISOString();
    db()
      .prepare(INSERT_REFRESH)
      .run(id, userId, usedFamily, hash(token), expiresAt, nowIso());
    return { token, id };
  }

  pair(user: UserRecord): IssuedTokens {
    const refresh = this.issueRefresh(user.id);
    return {
      accessToken: this.signAccess(user),
      refreshToken: refresh.token,
      expiresIn: env.JWT_ACCESS_TTL_MINUTES * 60,
    };
  }

  /** Rotates the presented token; reusing an already rotated token revokes the whole family. */
  rotate(token: string): { user: UserRecord; next: IssuedTokens } {
    const row = db()
      .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
      .get(hash(token)) as RefreshRow | undefined;
    if (!row) throw unauthorized('Unknown refresh token');
    if (row.revoked_at) {
      db()
        .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL')
        .run(nowIso(), row.family);
      throw unauthorized('Refresh token reuse detected, all sessions in this family were revoked');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('Refresh token expired');

    db().prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
    const refreshed = users.byId(row.user_id);
    if (!refreshed) throw unauthorized('Account no longer exists');
    const next = this.issueRefresh(row.user_id, row.family);
    return {
      user: refreshed,
      next: {
        accessToken: this.signAccess(refreshed),
        refreshToken: next.token,
        expiresIn: env.JWT_ACCESS_TTL_MINUTES * 60,
      },
    };
  }

  revoke(token: string): void {
    db()
      .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(nowIso(), hash(token));
  }

  revokeAllForUser(userId: number): void {
    db()
      .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(nowIso(), userId);
  }

  activeSessions(userId: number): { id: string; createdAt: string; expiresAt: string }[] {
    const rows = db()
      .prepare(
        'SELECT id, created_at, expires_at FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
      )
      .all(userId) as { id: string; created_at: string; expires_at: string }[];
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at }));
  }
}

export const tokens = new TokenService();
