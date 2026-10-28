import express, { Router } from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins, env, isProduction } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './core/http';
import { sparql } from './sparql/client';
import { auditRouter, authRouter, permissionsRouter, usersRouter } from './routes/auth.routes';
import { entitiesRouter } from './routes/entities.routes';
import { dashboardRouter, consistencyRouter } from './routes/dashboard.routes';
import { metaRouter } from './routes/meta.routes';
import { publicRouter } from './routes/public.routes';
import { nlpRouter } from './routes/nlp.routes';
import { ontologyRouter } from './routes/ontology.routes';
import { searchRouter } from './routes/search.routes';
import { consoleRouter, sparqlRouter } from './routes/console.routes';
import { openApiDocument } from './openapi';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? undefined,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => !isProduction,
    }),
  );

  const api = Router();
  api.get('/openapi.json', (_req, res) => res.json(openApiDocument));
  api.use(
    '/docs',
    swaggerUi.serveFiles(openApiDocument as never, {}),
    swaggerUi.setup(openApiDocument, { customSiteTitle: 'MedicCare API' }),
  );

  api.get('/status', async (_req, res) => {
    const store = await sparql.ping();
    res.json({
      name: 'MedicCare API',
      version: '1.0.0',
      environment: env.NODE_ENV,
      sparql: store,
      dataset: env.FUSEKI_DATASET,
    });
  });

  api.use('/public', publicRouter);
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/audit', auditRouter);
  api.use('/permissions', permissionsRouter);
  api.use('/', entitiesRouter);
  api.use('/search', searchRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/consistency', consistencyRouter);
  api.use('/ontology', ontologyRouter);
  api.use('/nlp', nlpRouter);
  api.use('/console', consoleRouter);
  api.use('/sparql', sparqlRouter);
  api.use('/meta', metaRouter);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
