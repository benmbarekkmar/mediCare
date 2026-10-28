import type { ResultValue } from '../sparql/client';
import { sparql } from '../sparql/client';
import { prefixes } from '../sparql/prefixes';
import { assertSafeId, localOf } from '../sparql/escape';
import { entityRepo } from '../repos/entity.repo';
import { CLASS_PARENTS, CLASS_LABELS } from '../ontology/hierarchy';
import { badRequest, notFound } from '../core/errors';
import type { EntityKey} from '../ontology/registry';
import { ENTITY_KEYS, ENTITY_DEFS } from '../ontology/registry';

const q = (body: string): string => prefixes.withPrefixes(body);

/** IRI local name of any term, `owl:FunctionalProperty` included. */
const termName = (iri: string): string => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);

export interface OntologyStats {
  triples: number;
  tboxTriples: number;
  aboxTriples: number;
  classes: number;
  objectProperties: number;
  datatypeProperties: number;
  annotationProperties: number;
  namedIndividuals: number;
  axioms: {
    subclass: number;
    equivalentClass: number;
    disjointWith: number;
    someValuesFrom: number;
    hasKey: number;
    inverseOf: number;
    propertyChain: number;
    functional: number;
    restrictions: number;
  };
  individualsByEntity: Record<EntityKey, number>;
}

export interface ClassNode {
  id: string;
  label: string;
  parent?: string;
  individuals: number;
  children: ClassNode[];
}

export interface PropertyRow {
  name: string;
  kind: 'object' | 'datatype' | 'annotation';
  domain: string[];
  range: string[];
  inverse?: string;
  characteristics: string[];
  chains: string[][];
  usedBy: string[];
}

const VALUES_ROOTS = `VALUES ?root { ${ENTITY_KEYS.map((k) => `ont:${ENTITY_DEFS[k].classLocal}`).join(' ')} }`;

export class OntologyService {
  async stats(): Promise<OntologyStats> {
    const [totals, axioms, individuals] = await Promise.all([
      sparql.select(
        q(`SELECT ?k ?c WHERE {
          { SELECT ("triples" AS ?k) (COUNT(*) AS ?c) WHERE { ?s ?p ?o } } UNION
          { SELECT ("classes" AS ?k) (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a owl:Class } } UNION
          { SELECT ("objectProperties" AS ?k) (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a owl:ObjectProperty } } UNION
          { SELECT ("datatypeProperties" AS ?k) (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a owl:DatatypeProperty } } UNION
          { SELECT ("annotationProperties" AS ?k) (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a owl:AnnotationProperty } } UNION
          { SELECT ("namedIndividuals" AS ?k) (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a owl:NamedIndividual } } UNION
          { SELECT ("tbox" AS ?k) (COUNT(*) AS ?c) WHERE {
              ?s a ?meta .
              FILTER(?meta IN (owl:Class, owl:ObjectProperty, owl:DatatypeProperty, owl:AnnotationProperty))
              ?s ?p ?o
            } }
        }
        LIMIT 50`),
      ),
      sparql.select(
        q(`SELECT ?k ?c WHERE {
          { SELECT ("subclass" AS ?k) (COUNT(*) AS ?c) WHERE { ?s rdfs:subClassOf ?o } } UNION
          { SELECT ("equivalentClass" AS ?k) (COUNT(*) AS ?c) WHERE { ?s owl:equivalentClass ?o } } UNION
          { SELECT ("disjointWith" AS ?k) (COUNT(*) AS ?c) WHERE { ?s a owl:AllDisjointClasses } } UNION
          { SELECT ("someValuesFrom" AS ?k) (COUNT(*) AS ?c) WHERE { ?r owl:someValuesFrom ?o } } UNION
          { SELECT ("hasKey" AS ?k) (COUNT(*) AS ?c) WHERE { ?s owl:hasKey ?k2 } } UNION
          { SELECT ("inverseOf" AS ?k) (COUNT(*) AS ?c) WHERE { ?s owl:inverseOf ?o } } UNION
          { SELECT ("propertyChain" AS ?k) (COUNT(*) AS ?c) WHERE { ?s owl:propertyChainAxiom ?o } } UNION
          { SELECT ("functional" AS ?k) (COUNT(*) AS ?c) WHERE { ?s a owl:FunctionalProperty } } UNION
          { SELECT ("restrictions" AS ?k) (COUNT(*) AS ?c) WHERE { ?r a owl:Restriction } }
        }
        LIMIT 50`),
      ),
      sparql.select(
        q(`SELECT ?cls (COUNT(DISTINCT ?ind) AS ?c) WHERE {
          ?ind rdf:type ?cls .
          ${VALUES_ROOTS}
          FILTER(?cls = ?root)
        }
        GROUP BY ?cls`),
      ),
    ]);

    const pick = (rows: Record<string, ResultValue | undefined>[], key: string): number =>
      Number(rows.find((r) => r['k']?.value === key)?.['c']?.value ?? 0);

    const individualsByEntity = Object.fromEntries(ENTITY_KEYS.map((k) => [k, 0])) as Record<EntityKey, number>;
    for (const row of individuals.rows) {
      const cls = localOf(row['cls']?.value ?? '');
      const key = ENTITY_KEYS.find((k) => ENTITY_DEFS[k].classLocal === cls);
      if (key) individualsByEntity[key] = Number(row['c']?.value ?? 0);
    }

    return {
      triples: pick(totals.rows, 'triples'),
      tboxTriples: pick(totals.rows, 'tbox'),
      aboxTriples: Math.max(0, pick(totals.rows, 'triples') - pick(totals.rows, 'tbox')),
      classes: pick(totals.rows, 'classes'),
      objectProperties: pick(totals.rows, 'objectProperties'),
      datatypeProperties: pick(totals.rows, 'datatypeProperties'),
      annotationProperties: pick(totals.rows, 'annotationProperties'),
      namedIndividuals: pick(totals.rows, 'namedIndividuals'),
      axioms: {
        subclass: pick(axioms.rows, 'subclass'),
        equivalentClass: pick(axioms.rows, 'equivalentClass'),
        disjointWith: pick(axioms.rows, 'disjointWith'),
        someValuesFrom: pick(axioms.rows, 'someValuesFrom'),
        hasKey: pick(axioms.rows, 'hasKey'),
        inverseOf: pick(axioms.rows, 'inverseOf'),
        propertyChain: pick(axioms.rows, 'propertyChain'),
        functional: pick(axioms.rows, 'functional'),
        restrictions: pick(axioms.rows, 'restrictions'),
      },
      individualsByEntity,
    };
  }

  /** Class tree rebuilt from the asserted `rdfs:subClassOf` triples. */
  async hierarchy(): Promise<ClassNode[]> {
    const { rows } = await sparql.select(
      q(`SELECT ?c ?parent ?label (COUNT(DISTINCT ?ind) AS ?individuals) WHERE {
          ?c a owl:Class .
          OPTIONAL { ?c rdfs:subClassOf ?parent . FILTER(!isBlank(?parent)) }
          OPTIONAL { ?c rdfs:label ?label }
          OPTIONAL { ?ind rdf:type ?c }
          FILTER(!isBlank(?c))
        }
        GROUP BY ?c ?parent ?label
        ORDER BY ?c`),
    );
    const nodes = new Map<string, ClassNode>();
    for (const row of rows) {
      const id = localOf(row['c']?.value ?? '');
      if (!id) continue;
      nodes.set(id, {
        id,
        label: row['label']?.value ?? CLASS_LABELS[id] ?? id,
        parent: row['parent']?.value ? localOf(row['parent'].value) : undefined,
        individuals: Number(row['individuals']?.value ?? 0),
        children: [],
      });
    }
    const roots: ClassNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parent ? nodes.get(node.parent) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const sort = (list: ClassNode[]): ClassNode[] => {
      list.sort((a, b) => a.label.localeCompare(b.label));
      list.forEach((n) => sort(n.children));
      return list;
    };
    return sort(roots);
  }

  async properties(): Promise<PropertyRow[]> {
    const [{ rows }, chains] = await Promise.all([
      sparql.select(
      q(`SELECT ?p ?kind ?domain ?range ?inverse ?char WHERE {
          { ?p a owl:ObjectProperty . BIND("object" AS ?kind) } UNION
          { ?p a owl:DatatypeProperty . BIND("datatype" AS ?kind) } UNION
          { ?p a owl:AnnotationProperty . BIND("annotation" AS ?kind) }
          OPTIONAL { ?p rdfs:domain ?domain }
          OPTIONAL { ?p rdfs:range ?range }
          OPTIONAL { ?p owl:inverseOf ?inverse }
          OPTIONAL { ?p a ?char FILTER(?char IN (owl:FunctionalProperty, owl:InverseFunctionalProperty, owl:TransitiveProperty, owl:SymmetricProperty, owl:IrreflexiveProperty)) }
        }
        ORDER BY ?kind ?p`),
      ),
      sparql.select(
        q(`SELECT ?p ?item WHERE {
             ?p owl:propertyChainAxiom ?list .
             ?list rdf:rest* ?rest .
             ?rest rdf:first ?item .
           }
           ORDER BY ?p`),
      ),
    ]);
    const chainMembers = new Map<string, string[]>();
    for (const row of chains.rows) {
      const p = row['p']?.value ? localOf(row['p'].value) : '';
      const item = row['item']?.value ? localOf(row['item'].value) : '';
      if (!p || !item) continue;
      if (!chainMembers.has(p)) chainMembers.set(p, []);
      chainMembers.get(p)?.push(item);
    }
    const byName = new Map<string, PropertyRow>();
    for (const row of rows) {
      const name = localOf(row['p']?.value ?? '');
      if (!name) continue;
      const existing = byName.get(name) ?? {
        name,
        kind: (row['kind']?.value as PropertyRow['kind']) ?? 'object',
        domain: [],
        range: [],
        characteristics: [],
        chains: [],
        usedBy: [],
      };
      if (row['domain']?.value) existing.domain.push(localOf(row['domain'].value));
      if (row['range']?.value) existing.range.push(localOf(row['range'].value));
      if (row['inverse']?.value) existing.inverse = localOf(row['inverse'].value);
      const characteristic = row['char']?.value ?? '';
      // an unbound OPTIONAL on an expression position can yield a boolean literal
      if (/^https?:/.test(characteristic)) existing.characteristics.push(termName(characteristic));

      byName.set(name, existing);
    }
    for (const [name, row] of byName) {
      const members = chainMembers.get(name);
      if (members) row.chains = [members];
    }
    const list = [...byName.values()];
    // the OPTIONAL cross product repeats values, the UI wants each once
    for (const row of list) {
      row.domain = [...new Set(row.domain)];
      row.range = [...new Set(row.range)];
      row.characteristics = [...new Set(row.characteristics)];
    }
    for (const def of ENTITY_KEYS.map((k) => ENTITY_DEFS[k])) {
      for (const rel of def.relations) {
        byName.get(rel.predicate)?.usedBy.push(`${def.key}.${rel.field}`);
        byName.get(rel.inverse)?.usedBy.push(`${def.key}.${rel.field}`);
      }
      for (const data of def.data) byName.get(data.predicate)?.usedBy.push(`${def.key}.${data.field}`);
    }
    return list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }

  /** Named individuals asserted under one class, with their full type set. */
  async individuals(classLocal: string, limit = 200): Promise<{
    classLocal: string;
    label: string;
    total: number;
    items: { id: string; iri: string; label: string; types: string[] }[];
  }> {
    const cls = assertSafeId(classLocal);
    if (!(cls in CLASS_PARENTS))
      throw badRequest(`Unknown class "${cls}". Known classes: ${Object.keys(CLASS_PARENTS).join(', ')}.`);
    const size = Math.max(1, Math.min(500, Math.trunc(limit)));
    const [{ rows: countRows }, { rows }] = await Promise.all([
      sparql.select(q(`SELECT (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s rdf:type ont:${cls} }`)),
      sparql.select(
        q(`SELECT DISTINCT ?s ?label WHERE {
            ?s rdf:type ont:${cls} .
            OPTIONAL { ?s rdfs:label ?label }
          } ORDER BY ?label LIMIT ${size}`),
      ),
    ]);
    const iris = rows.map((r) => r['s']?.value ?? '');
    const typesByIri = await entityRepo.typesOf(iris);
    return {
      classLocal: cls,
      label: CLASS_LABELS[cls] ?? cls,
      total: Number(countRows[0]?.['c']?.value ?? 0),
      items: rows.map((row) => {
        const iri = row['s']?.value ?? '';
        return {
          id: localOf(iri),
          iri,
          label: row['label']?.value ?? localOf(iri),
          types: [...new Set(typesByIri.get(iri) ?? [])],
        };
      }),
    };
  }

  /** Every asserted triple of one individual, in both directions. */
  async individualGraph(id: string): Promise<{
    id: string;
    iri: string;
    outgoing: AssertedTriple[];
    incoming: AssertedTriple[];
  }> {
    const iri = `${prefixes.get('ont')}${id}`;
    const [out, inn] = await Promise.all([
      sparql.select(q(`SELECT ?p ?o WHERE { <${iri}> ?p ?o } ORDER BY ?p`)),
      sparql.select(q(`SELECT ?s ?p WHERE { ?s ?p <${iri}> } ORDER BY ?p`)),
    ]);
    return {
      id,
      iri,
      outgoing: out.rows.map((row) => ({
        predicate: display(row['p']?.value ?? ''),
        value: valueOf(row['o']),
        type: row['o']?.type ?? 'literal',
      })),
      incoming: inn.rows.map((row) => ({
        predicate: display(row['p']?.value ?? ''),
        value: localOf(row['s']?.value ?? ''),
        type: 'iri',
      })),
    };
  }

  /** Nodes and edges for the ontology graph view, limited to the ABox neighbourhood. */
  async graph(limit = 160): Promise<GraphPayload> {
    const { rows } = await sparql.select(
      q(`SELECT ?s ?p ?o WHERE {
          ?s ?p ?o .
          FILTER(isIri(?s) && isIri(?o))
          FILTER(STRSTARTS(STR(?s), "${prefixes.get('ont')}") && STRSTARTS(STR(?o), "${prefixes.get('ont')}"))
          FILTER(?p != rdf:type)
        }
        LIMIT ${Math.max(10, Math.min(500, Math.trunc(limit)))}`),
    );
    return this.toGraph(rows);
  }

  /**
   * Ego graph used by the explorer: breadth first expansion over object
   * properties in both directions, so a patient reveals doctors, departments,
   * hospitals and diseases without loading the whole store.
   */
  async neighbourhood(focusId: string, depth = 2, limit = 160): Promise<GraphPayload & { focus: string }> {
    const local = assertSafeId(focusId);
    if (!(await entityRepo.exists(local)))
      throw notFound(`No individual ${local} in the store`);
    const focus = `${prefixes.get('ont')}${local}`;
    const maxDepth = Math.max(1, Math.min(3, Math.trunc(depth)));
    const cap = Math.max(10, Math.min(500, Math.trunc(limit)));
    const visited = new Set<string>([focus]);
    const edges: Record<string, ResultValue | undefined>[] = [];

    for (let level = 0; level < maxDepth; level++) {
      const frontier = [...visited].map((i) => `<${i}>`).join(' ');
      const { rows } = await sparql.select(
        q(`SELECT ?s ?p ?o WHERE {
            { VALUES ?s { ${frontier} } ?s ?p ?o . FILTER(isIri(?o)) } UNION
            { ?s ?p ?o . VALUES ?o { ${frontier} } FILTER(isIri(?s)) }
            FILTER(?p != rdf:type)
            FILTER(STRSTARTS(STR(?s), "${prefixes.get('ont')}") && STRSTARTS(STR(?o), "${prefixes.get('ont')}"))
          }
          LIMIT ${cap}`),
      );
      edges.push(...rows);
      const next = rows
        .flatMap((row) => [row['s']?.value ?? '', row['o']?.value ?? ''])
        .filter((iri) => iri && !visited.has(iri));
      if (next.length === 0 || visited.size >= cap) break;
      for (const iri of next) {
        if (visited.size >= cap) break;
        visited.add(iri);
      }
    }
    const unique = edges.filter(
      (row, index) =>
        edges.findIndex(
          (other) =>
            other['s']?.value === row['s']?.value &&
            other['p']?.value === row['p']?.value &&
            other['o']?.value === row['o']?.value,
        ) === index,
    );
    return { ...(await this.toGraph(unique)), focus: localOf(focus) };
  }

  private async toGraph(
    rows: Record<string, ResultValue | undefined>[],
  ): Promise<GraphPayload> {
    const labels = new Map<string, string>();
    for (const row of rows) {
      for (const key of ['s', 'o'] as const) {
        const iri = row[key]?.value;
        if (iri && !labels.has(iri)) labels.set(iri, localOf(iri));
      }
    }
    const iris = [...labels.keys()];
    if (iris.length === 0) return { nodes: [], edges: [] };
    const { rows: labelRows } = await sparql.select(
      q(`SELECT ?s ?label WHERE { VALUES ?s { ${iris.map((i) => `<${i}>`).join(' ')} } OPTIONAL { ?s rdfs:label ?label } }`),
    );
    for (const row of labelRows) if (row['label']?.value && row['s']?.value) labels.set(row['s'].value, row['label'].value);

    const nodes = [...labels.entries()].map(([iri, label]) => ({
      id: localOf(iri),
      label,
      group: groupOf(iri),
    }));
    const edges = rows.map((row) => ({
      source: localOf(row['s']?.value ?? ''),
      target: localOf(row['o']?.value ?? ''),
      label: localOf(row['p']?.value ?? ''),
    }));
    return { nodes, edges };
  }

  /** Static hierarchy as documented in the code, kept for the offline view. */
  staticHierarchy(): ClassNode[] {
    const nodes = new Map<string, ClassNode>();
    for (const name of Object.keys(CLASS_PARENTS))
      nodes.set(name, { id: name, label: CLASS_LABELS[name] ?? name, children: [], individuals: 0 });
    const roots: ClassNode[] = [];
    for (const name of Object.keys(CLASS_PARENTS)) {
      const node = nodes.get(name) as ClassNode;
      const parent = CLASS_PARENTS[name] ? nodes.get(CLASS_PARENTS[name] as string) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }
}

export interface AssertedTriple {
  predicate: string;
  value: string;
  type: string;
}

export interface GraphPayload {
  nodes: { id: string; label: string; group: string }[];
  edges: { source: string; target: string; label: string }[];
}

const display = (iri: string): string => prefixes.compact(iri).replace(/^ont:/, ':');

const valueOf = (term: ResultValue | undefined): string =>
  term ? (term.type === 'uri' ? localOf(term.value) : term.value) : '';

const groupOf = (iri: string): string => {
  const local = localOf(iri);
  const key = ENTITY_KEYS.find((k) => local.startsWith(ENTITY_DEFS[k].iriPrefix) || ENTITY_DEFS[k].classLocal === local);
  return key ?? 'other';
};

export const ontologyService = new OntologyService();
