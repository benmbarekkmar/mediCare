import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Every call to the back-end goes through here so the base url, the param
 * cleaning and the JSON shape stay identical across the whole application.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly base = environment.apiUrl;

  get<T>(path: string, params?: Record<string, QueryValue>): Observable<T> {
    return this.http.get<T>(this.url(path), { params: this.params(params) });
  }

  post<T>(path: string, body?: unknown, params?: Record<string, QueryValue>): Observable<T> {
    return this.http.post<T>(this.url(path), body ?? {}, { params: this.params(params) });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body);
  }

  /** `reassignTo` is the only body the delete endpoint reads, hence the object form. */
  delete<T>(path: string, body?: unknown): Observable<T> {
    return this.http.delete<T>(this.url(path), { body: body ?? null });
  }

  url(path: string): string {
    return `${this.base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /** Empty values are dropped: `q=` would otherwise be read as an empty search. */
  private params(values?: Record<string, QueryValue>): HttpParams {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(values ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      httpParams = httpParams.set(key, String(value));
    }
    return httpParams;
  }
}
