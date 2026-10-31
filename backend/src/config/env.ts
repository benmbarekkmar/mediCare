import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadEnv({ path: path.resolve(process.cwd(), '.env') });

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:4300'),

  FUSEKI_BASE_URL: z.string().url().default(process.env.FUSEKI_HOSTPORT ? 'http://' + process.env.FUSEKI_HOSTPORT : 'http://localhost:3030'),
  FUSEKI_DATASET: z.string().default('medicare'),
  FUSEKI_QUERY_PATH: z.string().default('/query'),
  FUSEKI_UPDATE_PATH: z.string().default('/update'),
  FUSEKI_USER: z.string().default('admin'),
  FUSEKI_PASSWORD: z.string().default(process.env.FUSEKI_ADMIN_PASSWORD ?? 'medicare'),
  FUSEKI_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  FUSEKI_SPARQL_LIMIT_CAP: z.coerce.number().int().positive().default(5000),

  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-1234567890'),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  SQLITE_FILE: z.string().default('./data/app.db'),

  NLP_SERVICE_URL: z.string().url().default(process.env.NLP_SERVICE_HOSTPORT ? 'http://' + process.env.NLP_SERVICE_HOSTPORT : 'http://localhost:8100'),
  NLP_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanString,

  SEED_DEMO_PASSWORD: z.string().default('Medicare@123'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isTest = env.NODE_ENV === 'test';
export const isProduction = env.NODE_ENV === 'production';
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
export const fusekiUrl = (suffix: string) =>
  `${env.FUSEKI_BASE_URL.replace(/\/$/, '')}/${env.FUSEKI_DATASET.replace(/^\/|\/$/g, '')}${suffix}`;
