import { beforeAll, describe, expect, it, vi } from 'vitest';
import { asSession, login, resetSqlite, type Session } from '../setup/api';
import { loadFixture } from '../setup/store';
import type { NlpParse } from '../../src/nlp/client';

const ONT = 'http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#';

/**
 * The Python service is mocked here: what this spec pins down is the Node side
 * contract, ie. the re-validation of the generated SPARQL, the role policy and
 * the result envelope. The language pipeline is covered by pytest.
 */
const plans = new Map<string, Partial<NlpParse>>();

vi.mock('../../src/nlp/client', () => ({
  nlpClient: {
    ask: vi.fn(async (payload: { question: string; ownPatient?: string }) => {
      const over = plans.get(payload.question) ?? {};
      const lastCall = { ...payload };
      (globalThis as { __lastNlpCall?: unknown }).__lastNlpCall = lastCall;
      return {
        question: payload.question,
        language: 'en',
        intent: 'list_instances',
        confidence: 0.9,
        entities: [],
        slots: {},
        filters: {},
        sparql: `SELECT ?s WHERE { ?s a ont:Medication } LIMIT 3`,
        explanation: { en: 'list' },
        suggestions: [],
        pipeline: [],
        allowedRoles: ['ADMIN'],
        classifierScores: {},
        ...over,
      } satisfies NlpParse;
    }),
    health: vi.fn(async () => ({ ok: true })),
    intents: vi.fn(async () => ({ intents: [] })),
    vocabulary: vi.fn(async () => ({ terms: 0 })),
    evaluation: vi.fn(async () => ({ accuracy: 1 })),
    reload: vi.fn(async () => ({ reloaded: true })),
  },
}));

const setPlan = (question: string, over: Partial<NlpParse>): void => {
  plans.set(question, over);
};

const KNOWLEDGE = 'Which medications exist?';
const OWN_RECORDS = 'What are my test results?';
const STAFF_REPORT = 'Which patients arrive as emergencies?';
const OTHER_PATIENT = "Show Mariam's diseases";
const DOCTOR_LIST = 'List all patients';

let admin: Session;
let doctor: Session;
let patient: Session;

beforeAll(async () => {
  resetSqlite();
  await loadFixture();
  admin = await login('ADMIN');
  doctor = await login('DOCTOR');
  patient = await login('PATIENT');

  setPlan(KNOWLEDGE, {
    intent: 'medications_by_class',
    slots: {},
    sparql: `SELECT ?m ?l WHERE { ?m a ont:Medication . OPTIONAL { ?m rdfs:label ?l } } LIMIT 5`,
  });
  setPlan(OWN_RECORDS, {
    intent: 'patient_tests',
    slots: { patient: 'Patient_Ahmed' },
    sparql: `SELECT ?t ?r WHERE { ?t ont:isTestOf <${ONT}Patient_Ahmed> . OPTIONAL { ?t ont:result ?r } } LIMIT 10`,
  });
  setPlan(STAFF_REPORT, {
    intent: 'emergency_patients',
    sparql: `SELECT ?p WHERE { ?p a ont:EmergencyPatient } LIMIT 10`,
  });
  setPlan(OTHER_PATIENT, {
    intent: 'patient_diseases',
    slots: { patient: 'Patient_Mariam' },
    sparql: `SELECT ?d WHERE { <${ONT}Patient_Mariam> ont:hasDisease ?d } LIMIT 10`,
  });
  setPlan(DOCTOR_LIST, {
    intent: 'list_instances',
    slots: { class: 'Patient' },
    sparql: `SELECT ?p WHERE { ?p a ont:Patient } LIMIT 50`,
  });
}, 180000);

describe('POST /api/nlp/ask', () => {
  it('refuses an anonymous question', async () => {
    const { api } = await import('../setup/api');
    const res = await api().post('/api/nlp/ask').send({ question: KNOWLEDGE });
    expect(res.status).toBe(401);
  });

  it('answers a general knowledge question for a patient and returns the result envelope', async () => {
    const res = await asSession(patient).post('/api/nlp/ask').send({ question: KNOWLEDGE }).expect(200);
    expect(res.body.parse.intent).toBe('medications_by_class');
    expect(res.body.sparql).toContain('PREFIX ont:');
    expect(res.body.columns).toContain('m');
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(typeof res.body.executionMs).toBe('number');
    expect(Object.keys(res.body).sort()).toEqual(
      ['columns', 'executionMs', 'parse', 'rows', 'sparql'].sort(),
    );
  });

  it('injects the caller own patient IRI instead of trusting the question', async () => {
    await asSession(patient).post('/api/nlp/ask').send({ question: OWN_RECORDS }).expect(200);
    const last = (globalThis as { __lastNlpCall?: { ownPatient?: string } }).__lastNlpCall;
    expect(last?.ownPatient).toBe('Patient_Ahmed');
  });

  it('refuses a staff-only report for a patient', async () => {
    const res = await asSession(patient).post('/api/nlp/ask').send({ question: STAFF_REPORT });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('refuses another patient record even when the service built the query', async () => {
    const res = await asSession(patient).post('/api/nlp/ask').send({ question: OTHER_PATIENT });
    expect(res.status).toBe(403);
  });

  it('lets the same question through for the back office', async () => {
    const res = await asSession(admin).post('/api/nlp/ask').send({ question: OTHER_PATIENT }).expect(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
  });

  it('scopes a doctor answer to the patients they follow', async () => {
    const res = await asSession(doctor).post('/api/nlp/ask').send({ question: DOCTOR_LIST }).expect(200);
    const seen = res.body.rows.map((row: Record<string, string>) => row.p);
    expect(seen).toEqual(
      expect.arrayContaining([`${ONT}Patient_Ahmed`]),
    );
    expect(seen.every((iri: string) => iri.startsWith(`${ONT}Patient_`))).toBe(true);
    // Doctor_Salma follows three of the demo patients
    expect(seen).toHaveLength(3);
  });

  it('never executes a write statement produced by the service', async () => {
    setPlan('Drop everything', { intent: 'list_instances', sparql: 'DELETE WHERE { ?s ?p ?o }' });
    const res = await asSession(admin).post('/api/nlp/ask').send({ question: 'Drop everything' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/SELECT, ASK, CONSTRUCT/i);
  });

  it('returns an empty result set when the question was not understood', async () => {
    setPlan('asdf qwerz', { intent: 'not_understood', sparql: '', confidence: 0.1 });
    const res = await asSession(patient).post('/api/nlp/ask').send({ question: 'asdf qwerz' }).expect(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.sparql).toBe('');
  });

  it('previews the generated query without executing it', async () => {
    const res = await asSession(patient).post('/api/nlp/preview').send({ question: STAFF_REPORT });
    expect(res.status).toBe(403);
    const ok = await asSession(patient).post('/api/nlp/preview').send({ question: KNOWLEDGE }).expect(200);
    expect(ok.body.rows).toEqual([]);
    expect(ok.body.sparql).toContain('PREFIX ont:');
    expect(ok.body.sparql).toContain('LIMIT 5');
  });

  it('keeps the vocabulary, evaluation and reload endpoints for the administrator', async () => {
    await asSession(patient).get('/api/nlp/vocabulary').expect(403);
    await asSession(doctor).get('/api/nlp/evaluation').expect(403);
    await asSession(doctor).post('/api/nlp/reload').expect(403);
    await asSession(admin).get('/api/nlp/vocabulary').expect(200);
    await asSession(admin).post('/api/nlp/reload').expect(200);
    await asSession(patient).get('/api/nlp/health').expect(200);
  });
});
