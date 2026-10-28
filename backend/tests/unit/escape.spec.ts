import { describe, expect, it } from 'vitest';
import {
  assertSafeId,
  escapeLiteral,
  escapeRegex,
  iriOf,
  iriToken,
  isSafeId,
  literalFor,
  localOf,
  quoted,
} from '../../src/sparql/escape';

describe('identifier validation', () => {
  it('accepts ontology style local names', () => {
    for (const id of ['Patient_Ahmed', 'BloodTest_006', 'MED-1', 'Cardiologist'])
      expect(assertSafeId(id)).toBe(id);
  });

  it('rejects anything that could break out of an IRI', () => {
    const rejected = ['', '1Patient', 'a b', 'a<b>', 'a>}', 'a"b', '-Patient', 'a'.repeat(130)];
    for (const id of rejected) expect(() => assertSafeId(id)).toThrow(/Invalid identifier/);
  });

  it('isSafeId never throws', () => {
    expect(isSafeId('Doctor_Salma')).toBe(true);
    expect(isSafeId('Doctor Salma')).toBe(false);
    expect(isSafeId(42)).toBe(false);
    expect(isSafeId(undefined)).toBe(false);
  });

  it('round trips a full IRI through iriOf/localOf', () => {
    const iri = iriOf('Patient_Sara');
    expect(iri).toMatch(/medical-care-ontology#Patient_Sara$/);
    expect(localOf(iri)).toBe('Patient_Sara');
    expect(localOf('https://example.org/other')).toBe('https://example.org/other');
  });

  it('iriToken validates before emitting the <...> form', () => {
    expect(() => iriToken('bad id}')).toThrow();
    expect(iriToken('Patient_Ahmed')).toMatch(/^<.+medical-care-ontology#Patient_Ahmed>$/);
  });
});

describe('literal escaping', () => {
  it('escapes the characters that would close a literal', () => {
    expect(escapeLiteral('a"b')).toBe('a\\"b');
    expect(escapeLiteral('back\\slash')).toBe('back\\\\slash');
    expect(escapeLiteral(`line\nnext`)).toBe('line\\nnext');
    expect(escapeLiteral('tab\tsep')).toBe('tab\\tsep');
    expect(escapeLiteral(`cr\rx`)).toBe('cr\\rx');
  });

  it('drops control characters instead of emitting an illegal one line literal', () => {
    expect(escapeLiteral(`bell\u0007bell`)).toBe('bellbell');
    expect(escapeLiteral(`nul\u0000x`)).toBe('nulx');
  });

  it('keeps accents and apostrophes untouched', () => {
    const value = "Hémoglobine glyquée d'hémolyse 48 %";
    expect(escapeLiteral(value)).toBe(value);
  });

  it('quoted() wraps the escaped value', () => {
    expect(quoted('Ben "Le Doctor" Ali')).toBe('"Ben \\"Le Doctor\\" Ali"');
  });

  it('neutralises SPARQL regex metacharacters in search terms', () => {
    expect(escapeRegex('a.*b')).toBe('a\\.\\*b');
    expect(escapeRegex('(hi)')).toBe('\\(hi\\)');
    expect(escapeRegex('plain word')).toBe('plain word');
  });
});

describe('literalFor', () => {
  it('emits a typed integer literal', () => {
    expect(literalFor(42, 'integer')).toMatch(/"42"\^\S+<.+integer>$/);
    expect(literalFor('7', 'integer')).toMatch(/"7"/);
  });

  it('rejects non integers', () => {
    expect(() => literalFor(4.2, 'integer')).toThrow(/Expected an integer/);
    expect(() => literalFor('abc', 'integer')).toThrow(/Expected an integer/);
  });

  it('normalises dates to xsd:dateTime without milliseconds', () => {
    const out = literalFor('2026-03-04T10:20:30.000Z', 'dateTime');
    expect(out).toMatch(/"2026-03-04T10:20:30"\^\S+<.+dateTime>$/);
    expect(() => literalFor('not a date', 'dateTime')).toThrow(/Invalid date/);
  });

  it('language tags text literals and leaves plain strings bare', () => {
    expect(literalFor('Fever', 'text')).toBe('"Fever"@en');
    expect(literalFor('Ahmed', 'string')).toBe('"Ahmed"');
  });
});
