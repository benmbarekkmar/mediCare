import { describe, expect, it } from 'vitest';
import {
  ENTITY_DEFS,
  ENTITY_KEYS,
  MANAGED_DATA_PROPERTIES,
  MANAGED_OBJECT_PROPERTIES,
  SPECIALTY_TO_DEPARTMENT,
  entityDef,
  isEntityKey,
} from '../../src/ontology/registry';
import { CLASS_PARENTS } from '../../src/ontology/hierarchy';

const DEFS = ENTITY_KEYS.map((key) => ENTITY_DEFS[key]);

describe('the registry describes every entity of the ontology', () => {
  it('holds ten entities, all self consistent', () => {
    expect(ENTITY_KEYS).toHaveLength(10);
    for (const def of DEFS) {
      expect(def.key).toBeTruthy();
      expect(entityDef(def.key)).toBe(def);
      expect(isEntityKey(def.key)).toBe(true);
      expect(CLASS_PARENTS[def.classLocal]).toBeUndefined();
      expect(def.nameField).toBeTruthy();
    }
    expect(isEntityKey('patients; DROP')).toBe(false);
    expect(isEntityKey('toString')).toBe(false);
  });

  it('never reuses a field name inside one entity', () => {
    for (const def of DEFS) {
      const names = [...def.data.map((d) => d.field), ...def.relations.map((r) => r.field)];
      expect(new Set(names).size, `${def.key} field names`).toBe(names.length);
      for (const data of def.data) {
        expect(data.predicate).toBeTruthy();
        expect(new Set(def.data.map((d) => d.predicate)).size).toBe(def.data.length);
      }
    }
  });

  it('binds the name field to its data property, or defers to the generated label', () => {
    for (const def of DEFS) {
      if (def.nameField === 'label') {
        expect(def.idStyle, def.key).toBe('sequence');
        continue;
      }
      const named = def.data.find((d) => d.predicate === def.namePredicate);
      expect(named, `${def.key} name predicate`).toBeDefined();
      expect(named?.field).toBe(def.nameField);
      expect(named?.required).toBe(true);
    }
  });

  it('gives every closed value list a real string field and a legal id param', () => {
    for (const def of DEFS) {
      for (const data of def.data) {
        if (data.values) expect(data.datatype, `${def.key}.${data.field}`).toBe('string');
        if (data.datatype === 'integer') expect(data.min).toBeTypeOf('number');
        const pattern = data.pattern;
        if (pattern) expect(() => new RegExp(pattern)).not.toThrow();
        expect(data.field).toMatch(/^[a-z][a-zA-Z]*$/);
      }
      const facet = def.typeFacet;
      if (facet)
        expect(
          def.data.some((d) => d.field === facet.field),
          `${def.key} facet field collides with a data field`,
        ).toBe(false);
    }
  });
});

describe('relations and their inverses', () => {
  it('mirrors every object property on the target entity', () => {
    for (const def of DEFS) {
      for (const rel of def.relations) {
        expect(isEntityKey(rel.target)).toBe(true);
        // the two property chain results have no inverse pair, only the patient asserts them
        if (rel.predicate.startsWith('followedIn')) {
          expect(rel.readOnly, `${def.key}.${rel.predicate}`).toBe(true);
          continue;
        }
        const counterpart = ENTITY_DEFS[rel.target].relations.find(
          (r) => r.predicate === rel.inverse && r.inverse === rel.predicate,
        );
        expect(counterpart, `${def.key}.${rel.predicate} <-> ${rel.target}.${rel.inverse}`).toBeDefined();
      }
    }
  });

  it('never lets a writable side also be marked readOnly or virtual', () => {
    for (const def of DEFS) {
      for (const rel of def.relations) {
        if (rel.readOnly || rel.virtual) continue;
        expect(rel.cardinality).toMatch(/^(one|many)$/);
      }
      const writableOne = def.relations.filter((r) => r.cardinality === 'one' && !r.readOnly);
      for (const rel of writableOne) expect(rel.functional, `${def.key}.${rel.predicate}`).toBe(true);
    }
  });

  it('exposes a filterParam on every relation an end user can filter by', () => {
    for (const def of DEFS) {
      for (const rel of def.relations) {
        if (!rel.filterParam) continue;
        expect(rel.filterParam).toMatch(/^[a-z][a-zA-Z]*$/);
      }
    }
  });

  it('keeps the derived property chain targets readOnly', () => {
    const patient = entityDef('patients');
    for (const field of ['department', 'hospital', 'appointments', 'tests'])
      expect(patient.relations.find((r) => r.field === field)?.readOnly, field).toBe(true);
  });
});

describe('type facets', () => {
  it('lists classes that all live directly under the entity root', () => {
    for (const def of DEFS) {
      if (!def.typeFacet) continue;
      for (const cls of def.typeFacet.classes) {
        expect(CLASS_PARENTS[cls], `${def.key} -> ${cls}`).toBe(def.classLocal);
      }
      const field = def.typeFacet.field;
      expect(def.typeFacet.filterParam).toBeTruthy();
      expect(def.typeFacet.label).toBeTruthy();
      expect(typeof def.typeFacet.multiple).toBe('boolean');
      expect(field).toBeTruthy();
    }
  });

  it('derives the sequence identifier from the facet when prefixFromType is set', () => {
    for (const def of DEFS) {
      if (def.idStyle !== 'sequence') continue;
      if (def.prefixFromType) expect(def.typeFacet, def.key).toBeDefined();
      else expect(def.iriPrefix, def.key).toBeTruthy();
    }
    expect(entityDef('appointments').prefixFromType).toBeFalsy();
    expect(entityDef('tests').prefixFromType).toBe(true);
  });

  it('uses a slug prefix for people and institutions', () => {
    expect(entityDef('patients').iriPrefix).toBe('Patient_');
    expect(entityDef('doctors').iriPrefix).toBe('Doctor_');
    expect(entityDef('hospitals').iriPrefix).toBe('Hospital_');
    expect(entityDef('symptoms').idStyle).toBe('sequence');
  });
});

describe('managed predicate sets', () => {
  it('covers both directions of every relation plus the chains', () => {
    expect(MANAGED_OBJECT_PROPERTIES).toContain('treatedBy');
    expect(MANAGED_OBJECT_PROPERTIES).toContain('treats');
    expect(MANAGED_OBJECT_PROPERTIES).toContain('followedInDepartment');
    expect(MANAGED_OBJECT_PROPERTIES).toContain('followedInHospital');
    expect(new Set(MANAGED_OBJECT_PROPERTIES).size).toBe(MANAGED_OBJECT_PROPERTIES.length);
    expect(MANAGED_OBJECT_PROPERTIES).toEqual([...MANAGED_OBJECT_PROPERTIES].sort());
  });

  it('covers every data predicate exactly once', () => {
    for (const def of DEFS)
      for (const data of def.data) expect(MANAGED_DATA_PROPERTIES).toContain(data.predicate);
    expect(new Set(MANAGED_DATA_PROPERTIES).size).toBe(MANAGED_DATA_PROPERTIES.length);
  });
});

describe('axiom lookup tables', () => {
  it('maps all five doctor specialties onto a department type', () => {
    const doctor = entityDef('doctors');
    for (const specialty of doctor.typeFacet?.classes ?? []) {
      const department = SPECIALTY_TO_DEPARTMENT[specialty];
      expect(department, specialty).toBeTruthy();
      expect(entityDef('departments').typeFacet?.classes).toContain(department);
    }
  });

  it('marks patients as the only derived entity', () => {
    expect(entityDef('patients').derivedPatient).toBe(true);
    for (const def of DEFS.filter((other) => other.key !== 'patients')) expect(def.derivedPatient).toBeFalsy();
  });
});
