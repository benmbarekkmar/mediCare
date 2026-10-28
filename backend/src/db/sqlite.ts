import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env';
import { logger } from '../config/logger';

/** SQLite holds only application accounts, refresh tokens and the audit trail. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','DOCTOR','RECEPTIONIST','PATIENT')),
  full_name     TEXT NOT NULL,
  linked_id     TEXT,
  locale        TEXT NOT NULL DEFAULT 'fr',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family     TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family);
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  email       TEXT,
  role        TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  resource_id TEXT,
  method      TEXT,
  path        TEXT,
  status      INTEGER,
  details     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
`;

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  const file = path.isAbsolute(env.SQLITE_FILE) ? env.SQLITE_FILE : path.resolve(process.cwd(), env.SQLITE_FILE);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.exec(SCHEMA);
  logger.debug({ file }, 'sqlite ready');
  return instance;
}

/** Used by the tests and by `npm run reset-db`. */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export const nowIso = (): string => new Date().toISOString();
