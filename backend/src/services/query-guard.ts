import { badRequest } from '../core/errors';

const READ_ONLY_START = /^\s*(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i;

const FORBIDDEN = [
  /\bINSERT\b/i,
  /\bDELETE\b/i,
  /\bCLEAR\b/i,
  /\bDROP\b/i,
  /\bLOAD\b/i,
  /\bADD\b/i,
  /\bMOVE\b/i,
  /\bCOPY\b/i,
  /\bCREATE\b/i,
  /\bSERVICE\s+[<"]/i,
  /\bUSING\b/i,
];

/**
 * Queries produced by the NLP module and typed in the admin console are executed
 * by the back-end, so they must pass this gate first: read-only forms only, no
 * remote SERVICE calls, no file LOAD, and a hard LIMIT ceiling.
 */
export function guardReadQuery(query: string, limitCap: number): string {
  const trimmed = query.trim();
  if (!trimmed) throw badRequest('Empty query');
  if (!READ_ONLY_START.test(stripPrefixes(trimmed)))
    throw badRequest('Only SELECT, ASK, CONSTRUCT and DESCRIBE queries are accepted here');
  for (const pattern of FORBIDDEN) {
    if (pattern.test(trimmed)) throw badRequest(`Forbidden SPARQL keyword: ${pattern.source.replace(/\\/g, '')}`);
  }
  if (/\bLIMIT\b/i.test(trimmed)) {
    const current = Number(/\bLIMIT\s+(\d+)/i.exec(trimmed)?.[1] ?? limitCap);
    if (Number.isFinite(current) && current > limitCap)
      return trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${limitCap}`);
    return trimmed;
  }
  // only a trailing statement separator is dropped, semicolons inside a
  // property list are part of the query
  const injection = trimmed.replace(/;\s*$/, '');
  return `${injection}\nLIMIT ${limitCap}`;
}

/**
 * The destructive verbs the specification forbids even for an administrator:
 * a manual update may insert and retract triples, never wipe a graph, read a
 * file or reach out to a remote endpoint.
 */
const FORBIDDEN_IN_UPDATE = [
  /\bCLEAR\b/i,
  /\bDROP\b/i,
  /\bLOAD\b/i,
  /\bADD\b/i,
  /\bMOVE\b/i,
  /\bCOPY\b/i,
  /\bCREATE\b/i,
  /\bSERVICE\s+[<"]/i,
  /\bWITH\s+[<]/i,
  /\bUSING\b/i,
];

/** Gate for the admin SPARQL Update escape hatch. */
export function guardUpdateStatement(update: string): string {
  const trimmed = update.trim();
  if (!trimmed) throw badRequest('Empty update');
  if (!/^\s*(INSERT|DELETE|DELETE\s*\{)/i.test(stripPrefixes(trimmed)))
    throw badRequest('Only INSERT DATA, INSERT WHERE, DELETE WHERE and DELETE/INSERT statements are accepted here');
  for (const pattern of FORBIDDEN_IN_UPDATE) {
    if (pattern.test(trimmed))
      throw badRequest(`Forbidden SPARQL keyword for a store update: ${pattern.source.replace(/\\/g, '')}`);
  }
  return trimmed;
}

export type ReadForm = 'select' | 'ask' | 'construct' | 'describe';
/** Which tuple form a (prefix-stripped) read query starts with. */
export function readForm(query: string): ReadForm {
  const head = stripPrefixes(query).match(/^\s*(\w+)/)?.[1]?.toLowerCase();
  if (head === 'ask') return 'ask';
  if (head === 'construct' || head === 'describe') return 'construct';
  return 'select';
}

const stripPrefixes = (query: string): string =>
  query
    .split('\n')
    .filter((line) => !/^\s*(PREFIX|BASE)\b/i.test(line))
    .join('\n')
    .trim();

/** Split a multi-operation update request into its individual operations. */
export function splitUpdate(update: string): string[] {
  return update
    .split(/\n;\s*\n|;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
