import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService, type QueryValue } from './api.service';
import type { ConsistencyReport, DashboardData, SearchResult } from './models';

export type HealthPayload = {
  ok: boolean;
  tripleStore: { ok: boolean; triples?: number; dataset?: string; error?: string };
  nlp: { ok: boolean; error?: string };
};

/** Aggregated KPIs, distributions and the two "recent" lists of the dashboards. */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  get(): Observable<DashboardData> {
    return this.api.get<DashboardData>('/dashboard');
  }
}

/** Axiom audit of the live store, with the repair that restores the closure. */
@Injectable({ providedIn: 'root' })
export class ConsistencyService {
  private readonly api = inject(ApiService);

  check(): Observable<ConsistencyReport> {
    return this.api.get<ConsistencyReport>('/consistency');
  }

  repair(): Observable<{ operations: number; triples: number }> {
    return this.api.post('/consistency/repair');
  }
}

/** The grouped live search behind the top bar and the Ctrl+K palette. */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly api = inject(ApiService);

  search(q: string, entities?: string, perEntity = 5): Observable<SearchResult> {
    return this.api.get<SearchResult>('/search', { q, entities, perEntity } as Record<string, QueryValue>);
  }
}

/** Fuseki and NLP availability for the status strip and the admin profile page. */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly api = inject(ApiService);

  check(): Observable<HealthPayload> {
    // the probe answers 503 when the store is down, and the body is still the report
    return this.api.get<HealthPayload>('/meta/health').pipe(
      catchError((error: HttpErrorResponse) =>
        of((error.error as HealthPayload) ?? { ok: false, tripleStore: { ok: false }, nlp: { ok: false } }),
      ),
    );
  }

  status(): Observable<{ name: string; version: string; environment: string; dataset: string; sparql: { ok: boolean } }> {
    return this.api.get('/status');
  }
}
