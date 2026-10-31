import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { ApiService } from '../api/api.service';
import type { Action, EntityKey, PermissionMatrix, PublicUser, Role, TokenPair } from '../api/models';

const STORAGE_KEY = 'medicare.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: PublicUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);

  private readonly sessionSignal = signal<StoredSession | null>(readStored());
  private readonly matrixSignal = signal<PermissionMatrix | null>(null);

  readonly session = computed(() => this.sessionSignal());
  readonly user = computed(() => this.sessionSignal()?.user ?? null);
  readonly role = computed<Role | null>(() => this.sessionSignal()?.user.role ?? null);
  readonly isLoggedIn = computed(() => this.sessionSignal() !== null);
  readonly permissions = computed(() => this.matrixSignal()?.permissions ?? {});
  readonly writableFields = computed(() => this.matrixSignal()?.writableFields ?? null);

  /** True once the access token is known to be accepted by the API. */
  private bootstrapped = false;
  readonly ready = signal(false);

  get accessToken(): string | null {
    const session = this.sessionSignal();
    return session && session.expiresAt > Date.now() ? session.accessToken : null;
  }

  /** The token as stored, even when it looks expired: the interceptor refreshes it. */
  get storedAccessToken(): string | null {
    return this.sessionSignal()?.accessToken ?? null;
  }

  /** Called when a refresh attempt failed: the session is gone for good. */
  forceLogout(): void {
    this.clear();
  }

  get refreshTokenValue(): string | null {
    return this.sessionSignal()?.refreshToken ?? null;
  }

  login(email: string, password: string): Observable<TokenPair> {
    return this.api.post<TokenPair>('/auth/login', { email, password }).pipe(
      tap((pair) => this.store(pair)),
      switchMap((pair) => this.loadMatrix().pipe(map(() => pair))),
    );
  }

  logout(): Observable<unknown> {
    const token = this.refreshTokenValue;
    const done = (): Observable<null> => {
      this.clear();
      return of(null);
    };
    if (!token) return done();
    return this.api.post<{ ok: boolean }>('/auth/logout', { refreshToken: token }).pipe(
      switchMap(() => done()),
      catchError(() => done()),
    );
  }

  /** Re-reads the account so a deactivation or a role change applies immediately. */
  me(): Observable<PublicUser> {
    return this.api.get<{ user: PublicUser }>('/auth/me').pipe(
      map((res) => {
        const current = this.sessionSignal();
        if (current) this.sessionSignal.set({ ...current, user: res.user });
        this.bootstrapped = true;
        return res.user;
      }),
    );
  }

  refresh(): Observable<TokenPair> {
    const refreshToken = this.refreshTokenValue;
    if (!refreshToken) return throwError(() => new Error('No refresh token'));
    return this.api.post<TokenPair>('/auth/refresh', { refreshToken }).pipe(
      tap((pair) => this.store(pair)),
      shareReplay(1),
    );
  }

  loadMatrix(): Observable<PermissionMatrix> {
    return this.api.get<PermissionMatrix>('/permissions/matrix').pipe(
      tap((matrix) => {
        this.matrixSignal.set(matrix);
        this.ready.set(true);
      }),
    );
  }

  can(entity: EntityKey, action: Action): boolean {
    return (this.matrixSignal()?.permissions?.[entity] ?? []).includes(action);
  }

  /** The fields this account may write on an entity, or null when the role is unrestricted. */
  editableFields(entity: EntityKey): string[] | null {
    const value = this.matrixSignal()?.writableFields?.[entity];
    return value === 'all' ? null : (value ?? []);
  }

  hasRole(...roles: Role[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  /** Restores a stored session and validates it once per application boot. */
  bootstrap(): void {
    if (this.bootstrapped || !this.sessionSignal()) return;
    this.bootstrapped = true;
    const afterAccount = (): void => {
      this.loadMatrix().subscribe({
        error: () => this.ready.set(true),
      });
    };
    this.me().subscribe({
      next: afterAccount,
      error: () =>
        this.refresh().subscribe({
          next: () => this.me().subscribe({ next: afterAccount, error: () => this.clear() }),
          error: () => {
            this.clear();
            this.ready.set(true);
          },
        }),
    });
  }

  private store(pair: TokenPair): void {
    const stored: StoredSession = {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresAt: Date.now() + (pair.expiresIn ?? 900) * 1000 - 15_000,
      user: pair.user,
    };
    this.sessionSignal.set(stored);
    writeStored(stored);
  }

  private clear(): void {
    this.sessionSignal.set(null);
    this.matrixSignal.set(null);
    this.bootstrapped = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage disabled */
    }
  }
}

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.accessToken && parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* private mode: the session simply lives in memory */
  }
}
