import { db, nowIso } from '../db/sqlite';
import type { Role, UserRecord } from './model';
import { env } from '../config/env';
import bcrypt from 'bcrypt';
import { conflict } from '../core/errors';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  full_name: string;
  linked_id: string | null;
  locale: string;
  active: number;
  created_at: string;
  last_login_at: string | null;
}

const map = (row: UserRow | undefined): UserRecord | null =>
  row
    ? {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role,
        fullName: row.full_name,
        linkedId: row.linked_id,
        locale: row.locale,
        active: row.active === 1,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      }
    : null;

export interface NewUser {
  email: string;
  password: string;
  role: Role;
  fullName: string;
  linkedId?: string | null;
  locale?: string;
}

/** Application accounts live in SQLite; clinical data stays in the triple store. */
export class UserRepository {
  hash(password: string): string {
    return bcrypt.hashSync(password, env.BCRYPT_ROUNDS);
  }

  create(input: NewUser): UserRecord {
    const email = input.email.trim().toLowerCase();
    const exists = db()
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email) as { id: number } | undefined;
    if (exists) throw conflict(`An account for ${email} already exists`);

    const info = db()
      .prepare(
        `INSERT INTO users (email, password_hash, role, full_name, linked_id, locale, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        email,
        this.hash(input.password),
        input.role,
        input.fullName.trim(),
        input.linkedId ?? null,
        input.locale ?? 'fr',
        nowIso(),
      );
    return this.byId(Number(info.lastInsertRowid)) as UserRecord;
  }

  byId(id: number): UserRecord | null {
    return map(db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined);
  }

  byEmail(email: string): UserRecord | null {
    return map(
      db().prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined,
    );
  }

  list(): UserRecord[] {
    return (db().prepare('SELECT * FROM users ORDER BY role, full_name').all() as UserRow[]).map(
      (row) => map(row) as UserRecord,
    );
  }

  update(id: number, patch: Partial<Omit<UserRecord, 'id' | 'createdAt' | 'passwordHash'>> & { password?: string }): UserRecord | null {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.email !== undefined) push('email', patch.email.trim().toLowerCase());
    if (patch.fullName !== undefined) push('full_name', patch.fullName.trim());
    if (patch.role !== undefined) push('role', patch.role);
    if (patch.linkedId !== undefined) push('linked_id', patch.linkedId);
    if (patch.locale !== undefined) push('locale', patch.locale);
    if (patch.active !== undefined) push('active', patch.active ? 1 : 0);
    if (patch.password) push('password_hash', this.hash(patch.password));
    if (sets.length > 0) {
      values.push(id);
      db().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.byId(id);
  }

  touchLogin(id: number): void {
    db().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), id);
  }

  remove(id: number): void {
    db().prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(id);
    db().prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  count(): number {
    const row = db().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return row.c;
  }

  verifyPassword(plain: string, hash: string): boolean {
    return bcrypt.compareSync(plain, hash);
  }
}

export const users = new UserRepository();
