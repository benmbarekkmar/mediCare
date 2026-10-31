import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { AuditEntry, PermissionMatrix, PublicUser, RegisterInput, SessionRow } from './models';

/** Account self-service and the ADMIN user management screen. */
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly api = inject(ApiService);

  matrix(): Observable<PermissionMatrix> {
    return this.api.get<PermissionMatrix>('/permissions/matrix');
  }

  sessions(): Observable<{ sessions: SessionRow[] }> {
    return this.api.get('/auth/sessions');
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ ok: boolean }> {
    return this.api.post('/auth/change-password', { currentPassword, newPassword });
  }

  /** Patient self-registration: the account and its Patient individual are created together. */
  register(input: RegisterInput): Observable<{ account: PublicUser; patient: { id: string } }> {
    return this.api.post('/auth/register', input);
  }

  forgotPassword(email: string): Observable<{ ok: boolean; delivered: boolean }> {
    return this.api.post('/auth/forgot-password', { email });
  }

  list(): Observable<{ items: PublicUser[] }> {
    return this.api.get<{ items: PublicUser[] }>('/users');
  }

  create(input: Record<string, unknown>): Observable<PublicUser> {
    return this.api.post<PublicUser>('/users', input);
  }

  update(id: number, patch: Record<string, unknown>): Observable<PublicUser> {
    return this.api.patch<PublicUser>(`/users/${id}`, patch);
  }

  remove(id: number): Observable<{ deleted: number }> {
    return this.api.delete(`/users/${id}`);
  }

  audit(query: { limit?: number; action?: string; entity?: string }): Observable<{ items: AuditEntry[] }> {
    return this.api.get<{ items: AuditEntry[] }>('/audit', query);
  }

  me(): Observable<{ user: PublicUser; profile: unknown }> {
    return this.api.get('/auth/me');
  }
}
