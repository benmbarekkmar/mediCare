import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isTest } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from './errors';

export interface ErrorBody {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Maps thrown values to the project wide `{status, code, message, details}` envelope. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError =
    err instanceof AppError
      ? err
      : new AppError(500, 'INTERNAL_ERROR', 'Unexpected server error', isTest ? err : undefined);

  const safePath = req.path.replace(/(\/api\/patients)\/[^/]+(?=\/|$)/i, '$1/:id');
  if (appError.status >= 500) {
    logger.error({ code: appError.code, status: appError.status, path: safePath, method: req.method }, 'request failed');
  } else {
    logger.warn({ path: safePath, method: req.method, code: appError.code, status: appError.status }, 'request rejected');
  }

  const body: ErrorBody = {
    status: appError.status,
    code: appError.code,
    message: appError.message,
  };
  if (appError.details !== undefined) body.details = appError.details;
  res.status(appError.status).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ErrorBody = {
    status: 404,
    code: 'NOT_FOUND',
    message: `No route matches ${req.method} ${req.originalUrl}`,
  };
  res.status(404).json(body);
}
