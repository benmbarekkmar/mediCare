import { describe, expect, it } from 'vitest';
import { accessFor, guardForPatient, isPatientIri, ownPatientFilter } from '../../src/nlp/policy';
import type { NlpParse } from '../../src/nlp/client';
import { AppError } from '../../src/core/errors';

const ONT = 'http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#';

const parse = (over: Partial<NlpParse>): NlpParse => ({
  question: 'test',
  language: 'en',
  intent: 'list_instances',
  confidence: 0.9,
  entities: [],
  slots: {},
  filters: {},
  sparql: '',
  explanation: {},
  suggestions: [],
  pipeline: [],
  allowedRoles: [],
  classifierScores: {},
  ...over,
});

describe('NLP role policy', () => {
  it('classifies knowledge, records and staff-only intents', () => {
    expect(accessFor(parse({ intent: 'disease_symptoms' }))).toBe('general');
    expect(accessFor(parse({ intent: 'patient_tests' }))).toBe('own');
    expect(accessFor(parse({ intent: 'emergency_patients' }))).toBe('staff');
    // an unknown intent is denied until it is reviewed
    expect(accessFor(parse({ intent: 'brand_new_intent' }))).toBe('staff');
  });

  it('treats a listing of people as personal data, a listing of knowledge as public', () => {
    expect(accessFor(parse({ intent: 'list_instances', slots: { class: 'Patient' } }))).toBe('staff');
    expect(accessFor(parse({ intent: 'count_instances', slots: { class: 'MedicalTest' } }))).toBe('staff');
    expect(accessFor(parse({ intent: 'list_instances', slots: { class: 'Medication' } }))).toBe('general');
    expect(accessFor(parse({ intent: 'describe_individual', slots: { hospital: 'CHU_Nord' } }))).toBe('general');
    expect(accessFor(parse({ intent: 'describe_individual', slots: { appointment: 'Appt_1' } }))).toBe('own');
  });

  it('lets a patient ask general questions but refuses staff reporting', () => {
    expect(() => guardForPatient(parse({ intent: 'disease_symptoms' }), null)).not.toThrow();
    expect(() => guardForPatient(parse({ intent: 'top_diseases_by_patients' }), null)).not.toThrow();
    expect(() => guardForPatient(parse({ intent: 'emergency_patients' }), 'Patient_Ahmed')).toThrow(AppError);
  });

  it('refuses a record that is not the caller own', () => {
    const asking = parse({ intent: 'patient_tests', slots: { patient: 'Patient_Mariam' } });
    expect(() => guardForPatient(asking, 'Patient_Ahmed')).toThrow(/your own medical record/);
  });

  it('requires a linked patient record for own-data questions', () => {
    expect(() => guardForPatient(parse({ intent: 'patient_diseases', slots: {} }), null)).toThrow(
      /not linked to a patient record/,
    );
  });

  it('inspects the generated query, not only the slots', () => {
    const sneaky = parse({
      intent: 'patient_tests',
      slots: { patient: 'Patient_Ahmed' },
      sparql: `SELECT ?r WHERE { ?t <${ONT}isTestOf> <${ONT}Patient_Mariam> }`,
    });
    expect(() => guardForPatient(sneaky, 'Patient_Ahmed')).toThrow(/not yours/);

    const clean = parse({
      intent: 'patient_tests',
      slots: { patient: 'Patient_Ahmed' },
      sparql: `SELECT ?r WHERE { ?t <${ONT}isTestOf> <${ONT}Patient_Ahmed> }`,
    });
    expect(() => guardForPatient(clean, 'Patient_Ahmed')).not.toThrow();
  });

  it('scopes doctor rows to the patients they follow', () => {
    const rows: Record<string, string>[] = [
      { p: `${ONT}Patient_Ahmed`, name: 'Ahmed' },
      { p: `${ONT}Patient_Mariam`, name: 'Mariam' },
      { h: `${ONT}CHU_Nord` },
    ];
    const kept = ownPatientFilter(new Set(['Patient_Ahmed', 'Patient_Mariam']))(rows);
    expect(kept).toHaveLength(3);
    expect(ownPatientFilter(new Set(['Patient_Ahmed']))(rows)).toEqual([rows[0], rows[2]]);
  });

  it('recognises patient individuals by namespace', () => {
    expect(isPatientIri(`${ONT}Patient_Ahmed`)).toBe(true);
    expect(isPatientIri(`${ONT}Doctor_Benali`)).toBe(false);
  });
});
