import { describe, expect, it } from 'vitest';
import {
  CLASS_LABELS,
  CLASS_PARENTS,
  ageClassFor,
  ancestorChain,
  classHumanLabel,
  closureTypes,
  departmentTypeForSpecialty,
  isAgeClass,
} from '../../src/ontology/hierarchy';

describe('ancestor chains', () => {
  it('walks a leaf up to its root', () => {
    expect(ancestorChain('Cardiologist')).toEqual(['Cardiologist', 'Doctor']);
    expect(ancestorChain('ChildPatient')).toEqual(['ChildPatient', 'Patient']);
  });

  it('returns the root alone when there is no parent', () => {
    expect(ancestorChain('Patient')).toEqual(['Patient']);
    expect(ancestorChain('Doctor')).toEqual(['Doctor']);
  });

  it('stops for a class the ontology does not define', () => {
    expect(ancestorChain('MadeUpClass')).toEqual(['MadeUpClass']);
  });
});

describe('closureTypes - the materialization rule', () => {
  it('adds the entity root, every superclass and owl:NamedIndividual', () => {
    const types = closureTypes('Doctor', ['Cardiologist']);
    expect(types).toContain('Cardiologist');
    expect(types).toContain('Doctor');
    expect(types).toContain('NamedIndividual');
  });

  it('merges superclasses of several asserted types without duplicates', () => {
    const types = closureTypes('Patient', ['ChildPatient', 'ChronicPatient', 'InfectiousDisease']);
    expect(types.filter((t) => t === 'Patient')).toHaveLength(1);
    expect(new Set(types)).toHaveLength(types.length);
    expect(types).toContain('Disease');
  });

  it('still asserts the root class when no specific type is given', () => {
    expect(closureTypes('Hospital', [])).toEqual(['Hospital', 'NamedIndividual']);
  });
});

describe('owl:equivalentClass age ranges', () => {
  it('mirrors the <18 / 18-64 / >=65 axioms', () => {
    expect(ageClassFor(0)).toBe('ChildPatient');
    expect(ageClassFor(17)).toBe('ChildPatient');
    expect(ageClassFor(18)).toBe('AdultPatient');
    expect(ageClassFor(64)).toBe('AdultPatient');
    expect(ageClassFor(65)).toBe('ElderlyPatient');
    expect(ageClassFor(120)).toBe('ElderlyPatient');
  });

  it('recognises exactly the three age classes', () => {
    expect(isAgeClass('ChildPatient')).toBe(true);
    expect(isAgeClass('ChronicPatient')).toBe(false);
  });
});

describe('labels and specialty axioms', () => {
  it('exposes a human label for every class in the hierarchy', () => {
    for (const cls of Object.keys(CLASS_PARENTS)) {
      expect(CLASS_LABELS[cls], `label for ${cls}`).toBeTruthy();
      expect(classHumanLabel(cls)).toBe(CLASS_LABELS[cls]);
    }
    expect(classHumanLabel('Unknown')).toBe('Unknown');
  });

  it('maps each doctor specialty onto the department type its someValuesFrom axiom requires', () => {
    expect(departmentTypeForSpecialty('Cardiologist')).toBe('CardiologyDepartment');
    expect(departmentTypeForSpecialty('GeneralPractitioner')).toBe('GeneralMedicineDepartment');
    expect(departmentTypeForSpecialty('Astronomer')).toBeUndefined();
  });

  it('keeps the static mirror consistent with itself', () => {
    for (const [cls, parent] of Object.entries(CLASS_PARENTS)) {
      if (parent === undefined) continue;
      expect(CLASS_PARENTS, `parent of ${cls}`).toHaveProperty(parent);
      expect(ancestorChain(cls).at(-1)).toBe(parent);
    }
  });
});
