import { sparql } from '../sparql/client';
import { containsExpr, iriToken } from '../sparql/builders';
import { prefixes } from '../sparql/prefixes';
import { localOf } from '../sparql/escape';
import type { EntityKey } from '../ontology/registry';
import { ENTITY_DEFS, ENTITY_KEYS } from '../ontology/registry';
import { buildFilters } from '../repos/filters';
import type { AuthUser} from '../auth/middleware';
import { can } from '../auth/middleware';

const OWL_NAMED = `${prefixes.get('owl')}NamedIndividual`;

export interface SearchHit {
  id: string;
  iri: string;
  label: string;
  entity: EntityKey;
  type: string | null;
  snippet: string;
}

export interface SearchGroup {
  entity: EntityKey;
  label: string;
  plural: string;
  total: number;
  items: SearchHit[];
}

/**
 * Cross entity free text search. Matching runs inside Fuseki over
 * rdfs:label, every searchable data property and the skos:altLabel synonyms
 * declared in the ontology, so "flu" finds Influenza and "high blood pressure"
 * finds Hypertension.
 */
export class SearchService {
  async search(
    term: string,
    user: AuthUser | null,
    entities: EntityKey[] = ENTITY_KEYS,
    perEntity = 5,
    filters: Record<string, string | undefined> = {},
  ): Promise<{ term: string; groups: SearchGroup[]; total: number; queries: string[] }> {
    const expression = containsExpr(term, '?lit');
    if (!expression) return { term, groups: [], total: 0, queries: [] };

    const allowed = entities.filter((key) => !user || can(user.role, key, 'read'));
    const groups = await Promise.all(allowed.map((key) => this.searchOne(key, term, expression, perEntity, filters, user)));
    const nonEmpty = groups.filter((g) => g.items.length > 0);
    return {
      term,
      groups: nonEmpty,
      total: nonEmpty.reduce((acc, g) => acc + g.total, 0),
      queries: this.lastQueries,
    };
  }

  private lastQueries: string[] = [];

  private async searchOne(
    key: EntityKey,
    term: string,
    expression: string,
    limit: number,
    filters: Record<string, string | undefined>,
    user: AuthUser | null,
  ): Promise<SearchGroup> {
    const def = ENTITY_DEFS[key];
    const properties = [
      'rdfs:label',
      'skos:altLabel',
      ...def.data.filter((d) => d.search).map((d) => iriToken(d.predicate)),
    ].join(' ');

    const scope =
      user && user.role === 'PATIENT' && user.linkedId && (key === 'patients' || key === 'tests' || key === 'appointments')
        ? `FILTER(?s = ${iriToken(user.linkedId)})`
        : user && user.role === 'DOCTOR' && user.linkedId && key === 'patients'
          ? `FILTER EXISTS { ?s ${iriToken('treatedBy')} ${iriToken(user.linkedId)} }`
          : '';

    const query = prefixes.withPrefixes(`SELECT ?s ?label (SAMPLE(?t) AS ?type) WHERE {
  ?s rdf:type ${iriToken(def.classLocal)} .
  OPTIONAL { ?s rdfs:label ?label }
  OPTIONAL { ?s rdf:type ?t FILTER(isIRI(?t) && ?t != ${iriToken(def.classLocal)} && ?t != <${OWL_NAMED}>) }
  FILTER EXISTS { ?s ?p ?lit . VALUES ?p { ${properties} } . FILTER(${expression}) }
  ${scope}
  ${buildFilters(def, { ...filters, q: undefined }).join('\n  ')}
}
GROUP BY ?s ?label
ORDER BY ?label
LIMIT ${Math.max(1, Math.min(25, Math.trunc(limit)))}`);
    this.lastQueries.push(query);
    const { rows } = await sparql.select(query);

    const countQuery = prefixes.withPrefixes(`SELECT (COUNT(DISTINCT ?s) AS ?c) WHERE {
  ?s rdf:type ${iriToken(def.classLocal)} .
  FILTER EXISTS { ?s ?p ?lit . VALUES ?p { ${properties} } . FILTER(${expression}) }
  ${scope}
  ${buildFilters(def, { ...filters, q: undefined }).join('\n  ')}
}`);
    const { rows: countRows } = await sparql.select(countQuery);

    const items = rows.map((row) => {
      const iri = row['s']?.value ?? '';
      const label = row['label']?.value ?? localOf(iri);
      return {
        id: localOf(iri),
        iri,
        label,
        entity: key,
        type: row['type'] ? localOf(row['type'].value) : null,
        snippet: snippetFor(label, term),
      };
    });

    return {
      entity: key,
      label: def.label,
      plural: def.plural,
      total: Number(countRows[0]?.['c']?.value ?? items.length),
      items,
    };
  }
}

/** short window around the match so the UI can highlight it */
const snippetFor = (label: string, term: string): string => {
  const index = label.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return label.slice(0, 90);
  const start = Math.max(0, index - 20);
  return `${start > 0 ? '…' : ''}${label.slice(start, index + term.length + 30)}${label.length > index + term.length + 30 ? '…' : ''}`;
};

export const searchService = new SearchService();
