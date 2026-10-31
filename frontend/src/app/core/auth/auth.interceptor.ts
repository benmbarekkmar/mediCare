import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, concatMap } from 'rxjs/operators';
import { AuthService } from './auth.service';

type UnknownRequest = HttpRequest<unknown>;

/**
 * Attaches the bearer token and, after a 401, refreshes once and replays the
 * request. If the refresh itself fails the account is cleared: the session
 * interceptor then routes the user to the login page.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/refresh');

  const attach = (request: UnknownRequest): UnknownRequest => {
    if (isAuthCall) return request;
    // the stored token is used even when it looks expired, so the 401 path
    // below can refresh it instead of silently dropping the Authorization header
    const token = auth.storedAccessToken;
    return token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
  };

  return next(attach(req)).pipe(
    catchError((error: HttpErrorResponse) => {
      if (isAuthCall || error.status !== 401 || !auth.refreshTokenValue) throw error;
      return auth.refresh().pipe(
        concatMap(() => next(attach(req))),
        catchError(() => {
          auth.forceLogout();
          throw error;
        }),
      );
    }),
  );
};
