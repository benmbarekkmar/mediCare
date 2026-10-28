import { createApp } from './app';
import { env, fusekiUrl } from './config/env';
import { logger } from './config/logger';
import { db } from './db/sqlite';
import { sparql } from './sparql/client';
import { users } from './auth/user.repo';

const app = createApp();

const server = app.listen(env.PORT, async () => {
  db(); // opens SQLite and applies the schema before the first request
  const store = await sparql.ping();
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      fuseki: fusekiUrl('/query'),
      triples: store.triples,
      storeError: store.error,
      accounts: await users.count(),
    },
    `MedicCare API listening on http://localhost:${env.PORT} (docs: /api/docs)`,
  );
  if (!store.ok)
    logger.warn('Fuseki is not reachable - start it with "docker compose up -d" or the documented manual command');
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
