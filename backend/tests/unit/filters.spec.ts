import { describe, expect, it } from 'vitest';
import { buildFilters, buildScope, dateTimeLiteral, enumValue, idValue } from '../../src/repos/filters';
import { entityDef } from '../../src/ontology/registry';

const B = (params: Record<string, string | undefined>) => buildFilters(entityDef('patients'), params);

describe('enum and id parameter validation', () => {
  it('resolves a closed value set case and space insensitively', () => {
    expect(enumValue('cardiovascular disease', ['CardiovascularDisease', 'ChronicDisease'], 'category')).toBe(
      'CardiovascularDisease',
    );
    expect(enumValue('O+', ['A+', 'O+'], 'bloodType')).toBe('O+');
  });

  it('rejects a value outside the set with the allowed list', () => {
    expect(() => enumValue('Cancer', ['ChronicDisease'], 'category')).toThrow(/Invalid value "Cancer"/);
  });

  it('rejects an unsafe identifier', () => {
    expect(idValue('Patient_Ahmed', 'doctor')).toBe('Patient_Ahmed');
    expect(() => idValue('Patient Ahmed', 'doctor')).toThrow(/Invalid identifier/);
  });

  it('normalises a plain date into an xsd:dateTime literal', () => {
    expect(dateTimeLiteral('2026-05-04', 'dateFrom')).toContain('2026-05-04T00:00:00');
    expect(dateTimeLiteral('2026-05-04', 'dateTo', true)).toContain('2026-05-04T23:59:59');
    expect(() => dateTimeLiteral('31-31-2026-bad', 'dateFrom')).toThrow(/Invalid date/);
  });
});

describe('patient filters', () => {
  it('translates ageGroup aliases into FILTER EXISTS on the derived class', () => {
    const child = B({ ageGroup: 'child' })[0] ?? '';
    expect(child).toMatch(/^FILTER EXISTS \{ \?s rdf:type <.*#ChildPatient> \}$/);
    expect(B({ ageGroup: 'senior' }).join()).toContain('ElderlyPatient');
    expect(B({ ageGroup: 'ElderlyPatient' }).join()).toContain('ElderlyPatient');
  });

  it('rejects an unknown age group', () => {
    expect(() => B({ ageGroup: 'teenager' })).toThrow(/Invalid ageGroup/);
  });

  it('maps the boolean shortcuts to their materialized classes', () => {
    expect(B({ chronic: 'true' }).join()).toContain('ChronicPatient');
    expect(B({ emergency: '1' }).join()).toContain('EmergencyPatient');
    expect(B({ chronic: 'no' })).toEqual([]);
  });

  it('keeps relation filters on both directions of the chain predicates', () => {
    const joined = B({
      doctor: 'Doctor_Salma',
      disease: 'Disease_Diabetes',
      department: 'CardiologyDepartment_001',
      hospital: 'Hospital_Centre',
    }).join('\n');
    expect(joined).toContain('treatedBy');
    expect(joined).toContain('hasDisease');
    expect(joined).toContain('followedInDepartment');
    expect(joined).toContain('followedInHospital');
  });

  it('bounds the age with integers only', () => {
    expect(B({ minAge: '18', maxAge: '65' }).join()).toContain('?__age >= 18');
    expect(() => B({ minAge: '18.5' })).toThrow(/Invalid integer/);
  });

  it('filters on an enumerated data property through its projected variable', () => {
    expect(B({ gender: 'Female' }).join()).toContain('?__gender = "Female"');
  });

  it('accepts an explicit id list and ignores empty parameters', () => {
    expect(B({ ids: 'Patient_Ahmed, Patient_Sara' })[0]).toContain('VALUES ?s {');
    expect(B({ ids: '', q: undefined, doctor: undefined })).toEqual([]);
  });

  it('refuses an injection attempt in a filter value', () => {
    expect(() => B({ doctor: 'x } UNION { ?a ?b ?c' })).toThrow();
  });
});

describe('filters on the other entities', () => {
  it('uses the type facet class for appointments and tests', () => {
    expect(buildFilters(entityDef('appointments'), { type: 'EmergencyAppointment' }).join()).toContain(
      'EmergencyAppointment>',
    );
    expect(() => buildFilters(entityDef('tests'), { type: 'PetScan' })).toThrow(/Invalid value "PetScan"/);
  });

  it('resolves an appointment hospital through the department chain', () => {
    const joined = buildFilters(entityDef('appointments'), { hospital: 'Hospital_Centre' }).join('\n');
    expect(joined).toContain('belongsToDepartment');
    expect(joined).toContain('locatedIn');
  });

  it('resolves a doctor hospital through the worksIn chain', () => {
    expect(buildFilters(entityDef('doctors'), { hospital: 'Hospital_Centre' }).join()).toContain('worksIn');
  });

  it('filters upcoming appointments on today', () => {
    expect(buildFilters(entityDef('appointments'), { upcoming: 'yes' }).join()).toContain('__date >=');
  });

  it('ignores parameters an entity does not expose', () => {
    expect(buildFilters(entityDef('hospitals'), { doctor: 'Doctor_Salma' })).toEqual([]);
  });
});

describe('row level scope', () => {
  it('is empty for an unscoped role', () => {
    expect(buildScope(entityDef('patients'), 'none', 'Patient_Ahmed')).toBe('');
  });

  it('restricts a patient to their own record', () => {
    expect(buildScope(entityDef('patients'), 'ownPatient', 'Patient_Ahmed')).toContain('FILTER(?s = <');
  });

  it('restricts a doctor to the patients they treat', () => {
    expect(buildScope(entityDef('patients'), 'treatingDoctor', 'Doctor_Salma')).toContain('treatedBy');
  });

  it('scopes appointments and tests through their patient link', () => {
    const asPatient = buildScope(entityDef('appointments'), 'ownPatient', 'Patient_Ahmed');
    expect(asPatient).toContain('appointmentOf');
    const asDoctor = buildScope(entityDef('tests'), 'treatingDoctor', 'Doctor_Salma');
    expect(asDoctor).toContain('isTestOf');
    expect(asDoctor).toContain('treatedBy');
  });

  it('does not scope reference entities, they are shared knowledge', () => {
    expect(buildScope(entityDef('diseases'), 'ownPatient', 'Patient_Ahmed')).toBe('');
  });

  it('rejects an unsafe individual id in the scope', () => {
    expect(() => buildScope(entityDef('patients'), 'ownPatient', 'x> <y> <z')).toThrow();
  });
});
