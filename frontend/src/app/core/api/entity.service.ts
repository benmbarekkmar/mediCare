import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, shareReplay } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import type { AncestryRow, EntityInput, EntityKey, EntityMeta, Individual, Page, Ref } from './models';

/** The ten entity collections share one CRUD surface: /api/{key}. */
@Injectable({ providedIn: 'root' })
export class EntitiesService {
  private readonly api = inject(ApiService);

  list(key: EntityKey, query: Record<string, string | number | boolean | null | undefined> = {}): Observable<Page<Individual>> {
    return this.api.get<Page<Individual>>(`/${key}`, query);
  }

  get(key: EntityKey, id: string): Observable<Individual> {
    return this.api.get<Individual>(`/${key}/${encodeURIComponent(id)}`);
  }

  /** Id + label only, for the pickers and the autocomplete: /api/doctors/refs?q=… */
  refs(key: EntityKey, q?: string, limit = 50): Observable<Ref[]> {
    return this.api.get<Ref[]>(`/${key}/refs`, { q, limit });
  }

  create(key: EntityKey, input: EntityInput): Observable<Individual> {
    return this.api.post<Individual>(`/${key}`, input);
  }

  update(key: EntityKey, id: string, input: EntityInput): Observable<Individual> {
    return this.api.patch<Individual>(`/${key}/${encodeURIComponent(id)}`, input);
  }

  remove(key: EntityKey, id: string, reassignTo?: string): Observable<{ deleted: number; cascaded?: number }> {
    return this.api.delete(`/${key}/${encodeURIComponent(id)}`, reassignTo ? { reassignTo } : undefined);
  }

  /** What would disappear or be orphaned if this individual were deleted. */
  dependents(key: EntityKey, id: string): Observable<{ entity: EntityKey; id: string; dependents: { entity: string; id: string; label: string; predicate: string }[] }> {
    return this.api.get(`/${key}/${encodeURIComponent(id)}/dependents`);
  }
}

/**
 * The registry the back-end exposes for the roles of the signed in account.
 * One fetch serves every table, form and filter, and the metadata is the reason
 * the UI never hard-codes an entity's fields.
 */
@Injectable({ providedIn: 'root' })
export class MetaService {
  private readonly api = inject(ApiService);
  private inflight: Observable<EntityMeta[]> | null = null;

  readonly entities = signal<EntityMeta[]>([]);
  readonly loaded = computed(() => this.entities().length > 0);

  /** Loaded once per session; every table and form reads its fields from here. */
  load(force = false): Observable<EntityMeta[]> {
    if (!force && this.entities().length > 0) return of(this.entities());
    if (!this.inflight || force) {
      this.inflight = this.api.get<EntityMeta[]>('/meta/entities').pipe(
        tap((list) => this.entities.set(list)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.inflight;
  }

  of(key: EntityKey): EntityMeta | undefined {
    return this.entities().find((meta) => meta.key === key);
  }
}

/** The controlled vocabularies and the class ancestry the back-end owns. */
@Injectable({ providedIn: 'root' })
export class VocabService {
  private readonly api = inject(ApiService);

  specialties(): Observable<{ specialties: string[]; diseaseCategories: string[] }> {
    return this.api
      .get<{ specialties: string[]; diseaseCategories: string[] }>('/meta/specialties')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
  }

  hierarchy(): Observable<{ ancestry: AncestryRow[] }> {
    return this.api
      .get<{ ancestry: AncestryRow[] }>('/meta/hierarchy')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
  }
}

/** Anonymous knowledge catalogues: no token, no patient data. */
@Injectable({ providedIn: 'root' })
export class PublicService {
  private readonly api = inject(ApiService);

  list(key: EntityKey, query: Record<string, string | number | undefined> = {}): Observable<Page<Individual>> {
    return this.api.get<Page<Individual>>(`/public/${key}`, query);
  }

  get(key: EntityKey, id: string): Observable<Individual> {
    return this.api.get<Individual>(`/public/${key}/${encodeURIComponent(id)}`);
  }
}
