import { describe, expect, it } from 'vitest';
import { ENTITY_DEFS } from '../../src/ontology/registry';
import { publicize } from '../../src/http/public-projection';

/**
 * The anonymous catalogues are served straight from the repository, which also
 * resolves each disease's and doctor's links to patients. These tests are the
 * guard that keeps that half of the answer out of the public payload.
 */
describe('public projection', () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: 'Disease_Diabetes',
    iri: 'http://example.org/medicare/Disease_Diabetes',
    label: 'Diabetes',
    types: ['Disease'],
    fields: { name: 'Diabetes' },
    relations: {
      symptoms: [{ id: 'Symptom_Polyuria', iri: 'x', label: 'Polyuria', type: 'Symptom' }],
      patients: [{ id: 'Patient_Ahmed', iri: 'y', label: 'Ahmed', type: 'Patient' }],
      ...extra,
    },
  });

  it('drops the patient links a disease carries', () => {
    const out = publicize(ENTITY_DEFS.diseases, row());
    expect(out.relations['patients']).toBeUndefined();
    expect(out.relations['symptoms']).toBeDefined();
    expect(out.label).toBe('Diabetes');
  });

  it('drops the patient links a doctor carries', () => {
    const def = ENTITY_DEFS.doctors;
    const withPatients = { ...row(), relations: { patients: [{ id: 'Patient_Ahmed', iri: 'y', label: 'Ahmed', type: 'Patient' }] } };
    expect(def.relations.some((relation) => relation.target === 'patients')).toBe(true);
    expect(publicize(def, withPatients).relations['patients']).toBeUndefined();
  });

  it('leaves a row without patient links untouched', () => {
    const hospital = { id: 'H_1', iri: 'h', label: 'CHU Nord', types: ['Hospital'], fields: {}, relations: { departments: [] } };
    expect(publicize(ENTITY_DEFS.hospitals, hospital)).toBe(hospital);
  });

  it('does not mutate the repository row it is given', () => {
    const source = row();
    publicize(ENTITY_DEFS.diseases, source);
    expect(source.relations['patients']).toBeDefined();
  });
});
