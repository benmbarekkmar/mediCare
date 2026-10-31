import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../toast/toast.service';
import type { ApiProblem } from '../api/models';

/**
 * One place turns REST failures into user feedback. Pages keep the error so they
 * can react to it (inline validation, retry buttons), the citizen never has to
 * open the console to learn that something went wrong.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toasts = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (!isSilent(error, req.url)) toasts.fromProblem(error);
      return throwError(() => error);
    }),
  );
};

const isSilent = (error: HttpErrorResponse, url: string): boolean => {
  // the login form renders its own message, a probe is allowed to fail quietly
  if (url.includes('/auth/login') && error.status === 401) return true;
  return error.status === 0 && url.includes('/status');
};

export const problemOf = (error: HttpErrorResponse): ApiProblem | null => {
  const body = error.error as ApiProblem | undefined;
  return body && typeof body.message === 'string' ? body : null;
};
