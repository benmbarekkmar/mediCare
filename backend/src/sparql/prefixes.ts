/** Namespace IRIs used across the application. */
export const NAMESPACES = {
  ont: 'http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
} as const;

export type NamespacePrefix = keyof typeof NAMESPACES;

/** Owns the `PREFIX` declarations injected into every generated query. */
export class PrefixRegistry {
  private readonly map = new Map<string, string>(Object.entries(NAMESPACES));

  get(prefix: string): string | undefined {
    return this.map.get(prefix);
  }

  /** Serialised `PREFIX` block, always in a stable order. */
  declarations(): string {
    return [...this.map.entries()]
      .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
      .join('\n');
  }

  /** Full query text: prefix block + body. */
  withPrefixes(body: string): string {
    return `${this.declarations()}\n${body}`;
  }

  /** Prefixes a query does not declare yet, so raw console input keeps its own bindings. */
  missingIn(query: string): string {
    const declared = new Set(
      [...query.matchAll(/^\s*PREFIX\s+([A-Za-z][\w-]*):/gim)].map((match) => match[1]?.toLowerCase() ?? ''),
    );
    return [...this.map.entries()]
      .filter(([prefix]) => !declared.has(prefix.toLowerCase()))
      .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
      .join('\n');
  }

  /** `<namespace>local` -> `:local` when the IRI belongs to a registered namespace. */
  compact(iri: string): string {
    for (const [prefix, ns] of this.map) {
      if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
    }
    return iri;
  }

  expand(compact: string): string {
    const match = /^([A-Za-z][\w-]*):(.+)$/.exec(compact);
    if (!match) return compact;
    const ns = this.map.get(match[1] as string);
    return ns ? `${ns}${match[2]}` : compact;
  }
}

export const prefixes = new PrefixRegistry();
