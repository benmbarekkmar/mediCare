import type { ResultValue } from '../sparql/client';
import { sparql } from '../sparql/client';
import { localOf, quoted, ONT } from '../sparql/escape';
import { NAMESPACES, prefixes } from '../sparql/prefixes';
import { iriToken, limitOffset, orderBy, textSearch, whereBody } from '../sparql/builders';
import type { EntityDef, RelationDef } from '../ontology/registry';
import { ENTITY_DEFS } from '../ontology/registry';

/** Ontology local name for our classes, `NamedIndividual` for owl, full IRI otherwise. */
export const shortType = (iri: string): string => {
  if (iri.startsWith(ONT)) return localOf(iri);
  if (iri === `${NAMESPACES.owl}NamedIndividual`) return 'NamedIndividual';
  return iri;
};

export interface Ref {
  id: string;
  iri: string;
  label: string;
  type?: string;
}

export interface EntityItem {
  id: string;
  iri: string;
  label: string;
  types: string[];
  fields: Record<string, string | number | null>;
  relations: Record<string, Ref | Ref[] | null>;
}

export interface ListQuery {
  q?: string;
  page: number;
  pageSize: number;
  sort?: string;
  order?: 'asc' | 'desc';
  extraFilters: string[];
  scope?: string;
}

const valueToJs = (v: ResultValue | undefined, datatype: string): string | number | null => {
  if (!v) return null;
  if (datatype === 'integer') return Number(v.value);
  return v.value;
};

const refType = (types: string[], def: EntityDef): string | undefined => {
  if (!def.typeFacet) return undefined;
  return def.typeFacet.classes.find((c) => types.includes(c));
};

/** SPARQL access layer shared by all ten entities. */
export class EntityRepository {
  private readonly ont = prefixes.get('ont') as string;

  constructor(private readonly s = sparql) {}

  /** WHERE fragment selecting every individual of an entity class. */
  private basePattern(def: EntityDef): string {
    const optionals = [
      'OPTIONAL { ?s rdfs:label ?__label }',
      ...def.data.map((d) => `OPTIONAL { ?s ${iriToken(d.predicate)} ?__${d.field} }`),
    ];
    return whereBody(`?s rdf:type ${iriToken(def.classLocal)} .`, ...optionals);
  }

  private projection(def: EntityDef): { select: string; vars: Record<string, string> } {
    const vars: Record<string, string> = { label: '?__label' };
    const selects = ['?s', '?__label'];
    for (const d of def.data) {
      vars[d.field] = `?__${d.field}`;
      selects.push(`?__${d.field}`);
    }
    return { select: selects.join(' '), vars };
  }

  async list(
    def: EntityDef,
    query: ListQuery,
    withRelations = true,
  ): Promise<{ items: EntityItem[]; total: number }> {
    const { select, vars } = this.projection(def);
    const base = this.basePattern(def);
    const search = query.q ? textSearch(query.q, ['?__label', ...def.data.filter((d) => d.search).map((d) => `?__${d.field}`)]) : '';
    const where = whereBody(base, ...query.extraFilters, query.scope ?? '', search);

    const countQuery = prefixes.withPrefixes(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE {\n  ${where}\n}`,
    );
    const { rows: countRows } = await this.s.select(countQuery);
    const total = Number(countRows[0]?.['total']?.value ?? 0);

    const sortField = query.sort && vars[query.sort] ? query.sort : undefined;
    const orderClause = orderBy(vars, sortField ? { field: sortField, order: query.order ?? 'asc' } : undefined, '?__label');
    const pageQuery = prefixes.withPrefixes(
      `SELECT ${select} WHERE {\n  ${where}\n}\n${orderClause}\n${limitOffset(query.pageSize, (query.page - 1) * query.pageSize)}`,
    );
    const { rows } = await this.s.select(pageQuery);

    const ids = rows.map((r) => r['s']?.value ?? '');
    const typesByIri = await this.typesOf(ids);
    const relationsByIri = withRelations ? await this.relationsOf(def, ids) : new Map<string, EntityItem['relations']>();

    const items = rows.map((row) => {
      const iri = row['s']?.value ?? '';
      const id = localOf(iri);
      const types = typesByIri.get(iri) ?? [];
      const fields: Record<string, string | number | null> = {};
      for (const d of def.data) fields[d.field] = valueToJs(row[`__${d.field}`], d.datatype);
      return {
        id,
        iri,
        label: row['__label']?.value ?? id,
        types,
        fields,
        relations: relationsByIri.get(iri) ?? {},
      };
    });

    return { items, total };
  }

  /** rdf:type closure per individual, in one round trip. */
  async typesOf(iris: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    const unique = [...new Set(iris.filter(Boolean))];
    if (unique.length === 0) return map;
    const values = unique.map(iriToken).join(' ');
    const query = prefixes.withPrefixes(
      `SELECT ?ind ?type WHERE { VALUES ?ind { ${values} } ?ind rdf:type ?type }`,
    );
    const { rows } = await this.s.select(query);
    for (const row of rows) {
      const ind = row['ind']?.value ?? '';
      const type = row['type'];
      if (!type || type.type !== 'uri') continue;
      if (!map.has(ind)) map.set(ind, []);
      map.get(ind)?.push(shortType(type.value));
    }
    return map;
  }

  async getById(def: EntityDef, id: string, withRelations = true): Promise<EntityItem | null> {
    const { select } = this.projection(def);
    const base = this.basePattern(def);
    const where = whereBody(base, `VALUES ?s { ${iriToken(id)} }`);
    const query = prefixes.withPrefixes(`SELECT ${select} WHERE {\n  ${where}\n}\nLIMIT 1`);
    const { rows } = await this.s.select(query);
    const row = rows[0];
    if (!row) return null;
    const iri = row['s']?.value ?? iriToken(id).slice(1, -1);
    const typesByIri = await this.typesOf([iri]);
    const types = typesByIri.get(iri) ?? [];
    const fields: Record<string, string | number | null> = {};
    for (const d of def.data) fields[d.field] = valueToJs(row[`__${d.field}`], d.datatype);
    const item: EntityItem = {
      id: localOf(iri),
      iri,
      label: row['__label']?.value ?? id,
      types,
      fields,
      relations: {},
    };
    if (withRelations) item.relations = await this.relationsOf(def, [iri]).then((m) => m.get(iri) ?? {});
    return item;
  }

  /** All registry relations for a set of individuals, both stored directions included. */
  async relationsOf(def: EntityDef, iris: string[]): Promise<Map<string, EntityItem['relations']>> {
    const result = new Map<string, EntityItem['relations']>();
    const unique = [...new Set(iris.filter(Boolean))];
    if (unique.length === 0) return result;
    const writable = def.relations;
    const predicates = [...new Set(writable.map((r) => r.predicate))];
    const values = unique.map(iriToken).join(' ');
    const predList = predicates.map(iriToken).join(' ');
    const query = prefixes.withPrefixes(
      `SELECT ?ind ?p ?target ?tlabel ?ttype WHERE {
        VALUES ?ind { ${values} }
        ?ind ?p ?target .
        VALUES ?p { ${predList} }
        OPTIONAL { ?target rdfs:label ?tlabel }
        OPTIONAL { ?target rdf:type ?ttype }
      }`,
    );
    const { rows } = await this.s.select(query);
    const typesByTarget = new Map<string, string[]>();
    for (const row of rows) {
      const t = row['target']?.value;
      const type = row['ttype']?.value;
      if (!t) continue;
      if (!typesByTarget.has(t)) typesByTarget.set(t, []);
      if (type) typesByTarget.get(t)?.push(shortType(type));
    }

    for (const iri of unique) result.set(iri, {});
    for (const rel of writable) {
      const targetDef = ENTITY_DEFS[rel.target];
      for (const row of rows) {
        const ind = row['ind']?.value ?? '';
        if (row['p']?.value !== `${this.ont}${rel.predicate}`) continue;
        const targetIri = row['target']?.value;
        if (!targetIri) continue;
        const ref: Ref = {
          id: localOf(targetIri),
          iri: targetIri,
          label: row['tlabel']?.value ?? localOf(targetIri),
          type: refType(typesByTarget.get(targetIri) ?? [], targetDef),
        };
        const bucket = result.get(ind);
        if (!bucket) continue;
        if (rel.cardinality === 'one') bucket[rel.field] = bucket[rel.field] ?? ref;
        else {
          const list = (bucket[rel.field] as Ref[] | undefined) ?? [];
          if (!list.some((r) => r.iri === ref.iri)) list.push(ref);
          bucket[rel.field] = list;
        }
      }
      // guarantee the key exists so the API shape is stable
      for (const iri of unique) {
        const bucket = result.get(iri);
        if (!bucket) continue;
        if (bucket[rel.field] === undefined) {
          bucket[rel.field] = rel.cardinality === 'one' ? null : [];
        }
      }
    }
    return result;
  }

  /** Lightweight `{id,label,type}` list for pickers and search endpoints. */
  async refs(def: EntityDef, limit = 20, q?: string): Promise<Ref[]> {
    const { select, vars } = this.projection(def);
    const base = this.basePattern(def);
    const search = q ? textSearch(q, ['?__label', ...def.data.filter((d) => d.search).map((d) => `?__${d.field}`)]) : '';
    const query = prefixes.withPrefixes(
      `SELECT ${select} WHERE {\n  ${whereBody(base, search)}\n}\n${orderBy(vars, undefined, '?__label')}\n${limitOffset(limit, 0)}`,
    );
    const { rows } = await this.s.select(query);
    const iris = rows.map((r) => r['s']?.value ?? '');
    const types = await this.typesOf(iris);
    return rows.map((row) => {
      const iri = row['s']?.value ?? '';
      return {
        id: localOf(iri),
        iri,
        label: row['__label']?.value ?? localOf(iri),
        type: refType(types.get(iri) ?? [], def),
      };
    });
  }

  /** Individuals holding exactly this literal value (uniqueness checks, lookups). */
  async findByDataProperty(def: EntityDef, predicate: string, value: string): Promise<EntityItem[]> {
    const select = prefixes.withPrefixes(
      `SELECT ?s ?label WHERE {
        ?s rdf:type ${iriToken(def.classLocal)} .
        ?s ${iriToken(predicate)} ${quoted(value)} .
        OPTIONAL { ?s rdfs:label ?label }
      } LIMIT 50`,
    );
    const { rows } = await this.s.select(select);
    return rows.map((row) => ({
      id: localOf(row['s']?.value ?? ''),
      iri: row['s']?.value ?? '',
      label: row['label']?.value ?? localOf(row['s']?.value ?? ''),
      types: [],
      fields: {},
      relations: {},
    }));
  }

  /** Individuals linked to this individual through a relation (dependency checks). */
  async dependents(def: EntityDef, rel: RelationDef, id: string): Promise<Ref[]> {
    void def;
    const targetDef = ENTITY_DEFS[rel.target];
    const query = prefixes.withPrefixes(
      `SELECT DISTINCT ?other ?olabel ?otype WHERE {
        ?other rdf:type ${iriToken(targetDef.classLocal)} .
        {
          ?other ${iriToken(rel.inverse)} ${iriToken(id)} .
        } UNION {
          ${iriToken(id)} ${iriToken(rel.predicate)} ?other .
        }
        OPTIONAL { ?other rdfs:label ?olabel }
        OPTIONAL { ?other rdf:type ?otype }
      } LIMIT 200`,
    );
    const { rows } = await this.s.select(query);
    const types = new Map<string, string[]>();
    const firstRow = new Map<string, Record<string, ResultValue | undefined>>();
    for (const row of rows) {
      const iri = row['other']?.value ?? '';
      if (!iri) continue;
      if (!firstRow.has(iri)) firstRow.set(iri, row);
      const type = row['otype'];
      if (!type || type.type !== 'uri') continue;
      if (!types.has(iri)) types.set(iri, []);
      types.get(iri)?.push(shortType(type.value));
    }
    // one entry per individual: the UNION and the type patterns yield several rows
    return [...firstRow.entries()].map(([iri, row]) => ({
      id: localOf(iri),
      iri,
      label: row['olabel']?.value ?? localOf(iri),
      type: refType(types.get(iri) ?? [], targetDef),
    }));
  }

  async exists(id: string, def?: EntityDef): Promise<boolean> {
    const typePattern = def ? `?s rdf:type ${iriToken(def.classLocal)} .` : '?s rdf:type ?t .';
    const query = prefixes.withPrefixes(
      `ASK WHERE { ${typePattern} FILTER(?s = ${iriToken(id)}) }`,
    );
    return this.s.ask(query);
  }
}

export const entityRepo = new EntityRepository();
