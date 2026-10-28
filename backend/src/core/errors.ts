export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'AXIOM_VIOLATION'
  | 'DEPENDENTS_EXIST'
  | 'RATE_LIMITED'
  | 'SPARQL_ERROR'
  | 'NLP_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

/** Application error carrying an HTTP status and a stable machine readable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action', details?: unknown): AppError =>
  new AppError(403, 'FORBIDDEN', message, details);
export const notFound = (message = 'Resource not found', details?: unknown): AppError =>
  new AppError(404, 'NOT_FOUND', message, details);
export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, 'CONFLICT', message, details);
export const unprocessable = (message: string, details?: unknown): AppError =>
  new AppError(422, 'AXIOM_VIOLATION', message, details);
export const serviceUnavailable = (message: string, details?: unknown): AppError =>
  new AppError(503, 'NLP_UNAVAILABLE', message, details);
