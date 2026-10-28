import { describe, expect, it } from 'vitest';
import { renderTriple, tripleBlockOf, removalOperation } from '../../src/ontology/writer';
import type { Triple } from '../../src/ontology/triples';
import { NAMESPACES } from '../../src/sparql/prefixes';

const ONT = NAMESPACES.ont;

const iriTriple = (subject: string, predicate: string, object: string): Triple => ({
  s: { kind: 'iri', value: `${ONT}${subject}` },
  p: { kind: 'iri', value: `${ONT}${predicate}` },
  o: { kind: 'iri', value: `${ONT}${object}` },
});

describe('renderTriple', () => {
  it('renders an iri object', () => {
    expect(renderTriple(iriTriple('Patient_Ahmed', 'treatedBy', 'Doctor_Salma'))).toBe(
      `<${ONT}Patient_Ahmed> <${ONT}treatedBy> <${ONT}Doctor_Salma>`,
    );
  });

  it('renders plain, integer, dateTime and language literals', () => {
    const base = { s: { kind: 'iri' as const, value: `${ONT}X` }, p: { kind: 'iri' as const, value: `${ONT}has` } };
    expect(renderTriple({ ...base, o: { kind: 'literal', value: 'Ahmed', datatype: 'string' } })).toBe(
      `<${ONT}X> <${ONT}has> "Ahmed"`,
    );
    expect(renderTriple({ ...base, o: { kind: 'literal', value: 45, datatype: 'integer' } })).toContain(
      `"45"^^<${NAMESPACES.xsd}integer>`,
    );
    expect(renderTriple({ ...base, o: { kind: 'literal', value: '2026-01-02T03:04:05.000Z', datatype: 'dateTime' } })).toContain(
      `"2026-01-02T03:04:05"^^<${NAMESPACES.xsd}dateTime>`,
    );
    expect(renderTriple({ ...base, o: { kind: 'lang', value: 'fever', lang: 'en' } })).toBe(
      `<${ONT}X> <${ONT}has> "fever"@en`,
    );
  });

  it('refuses a non IRI predicate', () => {
    expect(() =>
      renderTriple({
        s: { kind: 'iri', value: `${ONT}X` },
        p: { kind: 'literal', value: 'oops', datatype: 'string' },
        o: { kind: 'literal', value: 'y', datatype: 'string' },
      } as unknown as Triple),
    ).toThrow(/Predicate must be an IRI/);
  });
});

describe('tripleBlockOf', () => {
  it('produces an empty block for no triples', () => {
    expect(tripleBlockOf([])).toBe('{ }');
  });

  it('terminates every triple with a dot, as SPARQL requires', () => {
    const block = tripleBlockOf([
      iriTriple('Patient_Ahmed', 'treatedBy', 'Doctor_Salma'),
      iriTriple('Patient_Ahmed', 'hasDisease', 'Diabetes'),
    ]);
    const body = block.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
    const statements = body.split('\n');
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(statement.endsWith(' .')).toBe(true);
  });

  it('escapes a quote inside a literal instead of ending the statement', () => {
    const block = tripleBlockOf([
      {
        s: { kind: 'iri', value: `${ONT}X` },
        p: { kind: 'iri', value: `${ONT}has` },
        o: { kind: 'literal', value: 'a"b', datatype: 'string' },
      },
    ]);
    expect(block).toContain('"a\\"b" .');
  });
});

describe('removalOperation', () => {
  it('deletes every triple that names the individual, in either position', () => {
    const update = removalOperation(['Patient_Ahmed']);
    expect(update).toMatch(/^DELETE \{ \?sub \?pred \?obj \} WHERE \{/);
    expect(update).toContain('VALUES ?target {');
    expect(update).toContain(`${ONT}Patient_Ahmed>`);
    expect(update).toContain('FILTER(?sub = ?target || ?obj = ?target)');
    // no predicate whitelist, so nothing outside the registry can survive a delete
    expect(update).not.toContain('VALUES ?pred');
  });

  it('removes several individuals in one operation', () => {
    const update = removalOperation(['Patient_Ahmed', 'Appointment_001']);
    expect(update.match(/Patient_/g)).toHaveLength(1);
    expect(update).toContain('Appointment_001');
  });
});
