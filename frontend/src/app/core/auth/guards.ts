import { Injectable, inject } from '@angular/core';
import {
  CanActivateFn,
  CanDeactivateFn,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from './auth.service';
import type { Action, EntityKey, Role } from '../api/models';

/** Send an existing session to the dashboard that belongs to its role. */
export const authEntryGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const homes: Partial<Record<Role, string>> = {
    ADMIN: '/admin/dashboard',
    DOCTOR: '/doctor/dashboard',
    RECEPTIONIST: '/reception/dashboard',
    PATIENT: '/patient/dashboard',
  };
  const role = auth.role();
  const destination = role ? homes[role] : undefined;
  return auth.isLoggedIn() && destination ? router.parseUrl(destination) : true;
};
/** Blocked route: the account is signed in but the role is not allowed here. */
export const roleGuard =
  (...roles: Role[]): CanActivateFn =>
  (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isLoggedIn()) return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
    if (roles.length > 0 && !auth.hasRole(...roles)) return router.createUrlTree(['/error/403']);
    return true;
  };

/** The same matrix the API enforces, so the menu never promises a page that would 403. */
export const permissionGuard =
  (entity: EntityKey, action: Action = 'read'): CanActivateFn =>
  (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isLoggedIn()) return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
    const authorize = () => {
      if (auth.can(entity, action)) return true;
      const entityFromPath = route.params['entity'] as EntityKey | undefined;
      if (entityFromPath && auth.can(entityFromPath, action)) return true;
      return router.createUrlTree(['/error/403']);
    };
    if (auth.ready()) return authorize();
    return auth.loadMatrix().pipe(
      map(() => authorize()),
      catchError(() => of(router.createUrlTree(['/error/403']))),
    );
  };

export interface CanDeactivateForm<T = unknown> {
  canDeactivate(): Observable<boolean> | boolean;
  formValue?: T;
}

/** Forms with unsaved edits ask before the route changes or the tab closes. */
export const unsavedChangesGuard: CanDeactivateFn<CanDeactivateForm> = (component) =>
  component.canDeactivate ? component.canDeactivate() : true;

@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  blocked = false;

  /** Registers the `beforeunload` prompt while a form is dirty. */
  watch(): void {
    const handler = (event: BeforeUnloadEvent) => {
      if (!this.blocked) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', handler);
  }
}
