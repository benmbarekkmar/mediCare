import { assertSafeId, escapeLiteral } from './escape';
import { iriOf } from './escape';

export const fullIri = (local: string): string =>
  local.startsWith('http') ? local : iriOf(assertSafeId(local));

export const iriToken = (local: string): string => `<${fullIri(local)}>`;

/** `VALUES ?var { <iri> ... }` with validated IRIs; an empty list matches nothing. */
export function valuesIris(varName: string, locals: string[]): string {
  if (locals.length === 0) return 'FILTER(false)';
  return `VALUES ${varName} { ${locals.map(iriToken).join(' ')} }`;
}

export function valuesLiterals(varName: string, values: string[]): string {
  if (values.length === 0) return 'FILTER(false)';
  return `VALUES ${varName} { ${values.map((v) => `"${escapeLiteral(v)}"`).join(' ')} }`;
}

/** Case insensitive substring test on one variable, escaped against injection. */
export function containsExpr(term: string, varName: string): string | null {
  const clean = escapeLiteral(term).trim().toLowerCase();
  if (!clean) return null;
  return `CONTAINS(LCASE(STR(${varName})), "${clean}")`;
}

/** Free text search across optional variables, escaped and lowercased on both sides. */
export function textSearch(term: string, vars: string[]): string {
  if (vars.length === 0) return '';
  const alternatives = vars.map((v) => containsExpr(term, v)).filter((e): e is string => Boolean(e));
  if (alternatives.length === 0) return '';
  return `FILTER(${alternatives.join(' || ')})`;
}

export interface SortSpec {
  field: string;
  order: 'asc' | 'desc';
}

/** ORDER BY on a whitelisted variable; unbound OPTIONAL values are sorted last. */
export function orderBy(vars: Record<string, string>, sort: SortSpec | undefined, fallback: string): string {
  const varName = (sort ? vars[sort.field] : undefined) ?? fallback;
  const direction = sort?.order === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${direction}(COALESCE(${varName}, ""))`;
}

export const limitOffset = (limit: number, offset: number): string =>
  `LIMIT ${Math.max(1, Math.trunc(limit))} OFFSET ${Math.max(0, Math.trunc(offset))}`;

/** Composes WHERE fragments into one indented body. */
export function whereBody(...parts: (string | undefined | false)[]): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim())
    .join('\n    ');
}
