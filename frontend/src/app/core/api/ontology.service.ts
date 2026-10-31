import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type {
  ClassIndividualsPage,


  GraphPayload,
  HierarchyPayload,
  IndividualDetail,
  OntologyStats,
  PropertyRow,
} from './models';

/** The TBox/ABox census behind the Ontology Explorer and the admin profile. */
@Injectable({ providedIn: 'root' })
export class OntologyService {
  private readonly api = inject(ApiService);

  stats(): Observable<OntologyStats> {
    return this.api.get<OntologyStats>('/ontology/stats');
  }

  hierarchy(): Observable<HierarchyPayload> {
    return this.api.get<HierarchyPayload>('/ontology/classes');
  }

  individuals(classLocal: string, limit = 200): Observable<ClassIndividualsPage> {
    return this.api.get<ClassIndividualsPage>('/ontology/individuals', { class: classLocal, limit });
  }

  properties(): Observable<PropertyRow[]> {
    return this.api.get<PropertyRow[]>('/ontology/properties');
  }

  graph(limit = 160): Observable<GraphPayload> {
    return this.api.get<GraphPayload>('/ontology/graph', { limit });
  }

  neighbourhood(focus: string, depth = 2, limit = 160): Observable<GraphPayload> {
    return this.api.get<GraphPayload>('/ontology/graph', { focus, depth, limit });
  }

  individual(id: string): Observable<IndividualDetail> {
    return this.api.get<IndividualDetail>(`/ontology/individuals/${encodeURIComponent(id)}`);
  }
}

/** The guarded raw SPARQL surface, ADMIN only. */
@Injectable({ providedIn: 'root' })
export class ConsoleService {
  private readonly api = inject(ApiService);

  run(query: string, limit = 100): Observable<import('./models').ConsoleReadResult> {
    return this.api.post('/console/query', { query, limit });
  }

  update(update: string): Observable<import('./models').ConsoleUpdateResult> {
    return this.api.post('/console/update', { update, confirm: true });
  }
}
