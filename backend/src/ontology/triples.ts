import { NAMESPACES, prefixes } from '../sparql/prefixes';
import { escapeLiteral, iriOf, literalFor } from '../sparql/escape';

export type Term =
  | { kind: 'iri'; value: string }
  | { kind: 'literal'; value: unknown; datatype: 'string' | 'integer' | 'dateTime' | 'text' }
  | { kind: 'lang'; value: string; lang: string };

export interface Triple {
  s: Term;
  p: Term;
  o: Term;
}

export const iriTerm = (localOrFull: string): Term =>
  localOrFull.startsWith('http') || localOrFull.startsWith(':')
    ? { kind: 'iri', value: prefixes.expand(localOrFull) }
    : { kind: 'iri', value: iriOf(localOrFull) };

/** IRI of a well known rdf/owl/rdfs term, e.g. `rdf:type`. */
export const nsTerm = (compact: string): Term => {
  const [prefix, local] = compact.split(':');
  const ns = NAMESPACES[prefix as keyof typeof NAMESPACES];
  if (!ns) throw new Error(`Unknown namespace prefix ${compact}`);
  return { kind: 'iri', value: `${ns}${local}` };
};

export const literalTerm = (value: unknown, datatype: 'string' | 'integer' | 'dateTime' = 'string'): Term => ({
  kind: 'literal',
  value,
  datatype,
});

const termToString = (term: Term): string => {
  switch (term.kind) {
    case 'iri':
      return `<${term.value}>`;
    case 'lang':
      return `"${escapeLiteral(term.value)}"@${term.lang}`;
    case 'literal':
      return literalFor(term.value, term.datatype);
  }
};

export const tripleToString = (t: Triple): string =>
  `${termToString(t.s)} ${termToString(t.p)} ${termToString(t.o)}`;

/** Renders a triple list indented for a DELETE/INSERT block. */
export const tripleBlock = (triples: Triple[]): string =>
  triples.length === 0 ? '' : `{\n${triples.map((t) => `  ${tripleToString(t)}`).join('\n')}\n}`;
