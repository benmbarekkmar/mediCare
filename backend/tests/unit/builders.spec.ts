import { describe, expect, it } from 'vitest';
import {
  containsExpr,
  fullIri,
  iriToken,
  limitOffset,
  orderBy,
  textSearch,
  valuesIris,
  valuesLiterals,
  whereBody,
} from '../../src/sparql/builders';

describe('VALUES guards', () => {
  it('builds a VALUES block from validated local names', () => {
    const out = valuesIris('?s', ['Patient_Ahmed', 'Doctor_Salma']);
    expect(out).toContain('VALUES ?s {');
    expect(out).toContain('Patient_Ahmed');
    expect(out).toContain('Doctor_Salma');
  });

  it('turns an empty list into a filter that matches nothing', () => {
    expect(valuesIris('?s', [])).toBe('FILTER(false)');
    expect(valuesLiterals('?x', [])).toBe('FILTER(false)');
  });

  it('refuses an unsafe local name instead of interpolating it', () => {
    expect(() => valuesIris('?s', ['ok', '} drop <default>'])).toThrow();
  });

  it('passes through an absolute IRI untouched', () => {
    expect(iriToken('https://example.org/X')).toBe('<https://example.org/X>');
    expect(fullIri('https://example.org/X')).toBe('https://example.org/X');
  });
});

describe('free text search', () => {
  it('lowercases the term and keeps the surrounding literal intact', () => {
    const out = containsExpr('  Ahmed"  ', '?__label');
    expect(out).toBe('CONTAINS(LCASE(STR(?__label)), "ahmed\\"")');
  });

  it('returns null for blank terms so the caller can drop the FILTER', () => {
    expect(containsExpr('   ', '?__label')).toBeNull();
  });

  it('ORs the searchable variables together', () => {
    const filter = textSearch('sara', ['?__label', '?__name']);
    expect(filter).toMatch(/^FILTER\(/);
    expect(filter.match(/CONTAINS/g)).toHaveLength(2);
    expect(filter).toContain('||');
  });

  it('emits nothing when there is no variable or no usable term', () => {
    expect(textSearch('sara', [])).toBe('');
    expect(textSearch('   ', ['?__label'])).toBe('');
  });

  it('escapes a quoting attempt so it cannot terminate the literal', () => {
    const filter = textSearch('a" } UNION { ?x ?y ?z', ['?__label']);
    const inner = filter.slice(filter.indexOf('"') + 1, filter.lastIndexOf('"'));
    expect(inner.startsWith('a\\"')).toBe(true);
    expect(inner).not.toMatch(/(^|[^\\])"/);
  });
});

describe('ordering and paging', () => {
  const vars = { label: '?__label', name: '?__name', age: '?__age' };

  it('sorts on a whitelisted variable, unbound values last', () => {
    expect(orderBy(vars, { field: 'name', order: 'desc' }, '?__label')).toBe(
      'ORDER BY DESC(COALESCE(?__name, ""))',
    );
    expect(orderBy(vars, { field: 'name', order: 'asc' }, '?__label')).toBe(
      'ORDER BY ASC(COALESCE(?__name, ""))',
    );
  });

  it('falls back to the default variable for unknown fields', () => {
    expect(orderBy(vars, { field: 'password', order: 'asc' }, '?__label')).toBe(
      'ORDER BY ASC(COALESCE(?__label, ""))',
    );
    expect(orderBy(vars, undefined, '?__label')).toBe('ORDER BY ASC(COALESCE(?__label, ""))');
  });

  it('clamps LIMIT/OFFSET to sane positive integers', () => {
    expect(limitOffset(20, 40)).toBe('LIMIT 20 OFFSET 40');
    expect(limitOffset(-5, -9)).toBe('LIMIT 1 OFFSET 0');
    expect(limitOffset(12.9, 0.2)).toBe('LIMIT 12 OFFSET 0');
  });
});

describe('whereBody', () => {
  it('drops empty fragments and indents the rest', () => {
    expect(whereBody('?s rdf:type ?t .', undefined, '', false, 'FILTER(true)')).toBe(
      '?s rdf:type ?t .\n    FILTER(true)',
    );
  });
});
