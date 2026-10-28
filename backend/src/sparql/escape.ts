import { NAMESPACES } from './prefixes';
import { badRequest } from '../core/errors';

/** Local names we accept for individual IRIs: `Patient_Ahmed`, `BloodTest_006`, `MED-1`. */
const LOCAL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export const ONT = NAMESPACES.ont;

export const iriOf = (localName: string): string => `${ONT}${localName}`;

export const localOf = (iri: string): string => (iri.startsWith(ONT) ? iri.slice(ONT.length) : iri);

export function assertSafeId(value: string): string {
  if (!LOCAL_NAME_RE.test(value)) {
    throw badRequest(`Invalid identifier: "${value}" (expected ${LOCAL_NAME_RE.source})`);
  }
  return value;
}

export const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && LOCAL_NAME_RE.test(value);

/** Escapes a JS string so it can be embedded in a SPARQL single line `"..."` literal. */
export function escapeLiteral(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        // drop other control characters, they are not legal in a one line literal
        if (code < 0x20 || code === 0x7f) break;
        out += ch;
    }
  }
  return out;
}

export const quoted = (value: string): string => `"${escapeLiteral(value)}"`;

/** Turtle-style literal for a validated data property value. */
export function literalFor(value: unknown, datatype: 'string' | 'integer' | 'dateTime' | 'text'): string {
  if (datatype === 'integer') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n)) throw badRequest(`Expected an integer, received ${String(value)}`);
    return `"${n}"^^<${NAMESPACES.xsd}integer>`;
  }
  if (datatype === 'dateTime') {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date: ${String(value)}`);
    return `"${d.toISOString().replace(/\.\d{3}Z$/, '')}"^^<${NAMESPACES.xsd}dateTime>`;
  }
  // plain string, or language tagged text (labels)
  return datatype === 'text' ? `${quoted(String(value))}@en` : quoted(String(value));
}

/** `<iri>` with the IRI itself validated against injection. */
export function iriToken(localName: string): string {
  return `<${iriOf(assertSafeId(localName))}>`;
}

/** Escapes a user supplied search term for use inside SPARQL `REGEX(...)` (REX lexical class). */
export function escapeRegex(value: string): string {
  return value.replace(/([.*+?^=!:${}()|[\]/\\])/g, '\\$1');
}
