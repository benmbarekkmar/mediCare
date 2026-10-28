import { entityRepo } from '../repos/entity.repo';
import { asIri } from './derive';
import type {
  EntityDef} from './registry';
import { APPOINTMENT_STATUS, ENTITY_DEFS, SPECIALTY_TO_DEPARTMENT } from './registry';
import { AppError, conflict, unprocessable } from '../core/errors';
import { assertSafeId } from '../sparql/escape';

export interface ProposedState {
  id: string;
  /** asserted classes (most specific chosen types, closure added by the writer) */
  types: string[];
  data: Record<string, string | number | null>;
  relations: Record<string, string[]>;
}

export interface ValidationOptions {
  /**
   * Self-registration intake: a Patient individual is born before the back office
   * assigns its doctor and records a diagnosis, so the two existential axioms of
   * :Patient (`:treatedBy` / `:hasDisease` are declared `required` in the
   * registry) cannot be satisfied yet. Set only by the registration route; every
   * other write keeps enforcing them.
   */
  allowMissingMandatoryRelations?: boolean;
}

const fieldLabel = (def: EntityDef, field: string): string => field;

const errors = (messages: string[]): never => {
  throw unprocessable('The ontology axioms reject this change', { violations: messages });
};

/** Validates an entity state against every axiom the application must respect. */
export async function validateEntity(
  def: EntityDef,
  state: ProposedState,
  options: ValidationOptions = {},
): Promise<void> {
  const violations: string[] = [];

  for (const data of def.data) {
    const value = state.data[data.field];
    const hasValue = value !== undefined && value !== null && value !== '';
    if (data.required && !hasValue) {
      violations.push(`${fieldLabel(def, data.field)} is mandatory for a ${def.label}.`);
      continue;
    }
    if (!hasValue) continue;
    if (data.values && !data.values.includes(String(value))) {
      violations.push(
        `${fieldLabel(def, data.field)} must be one of: ${data.values.join(', ')} (received ${String(value)}).`,
      );
    }
    if (data.datatype === 'integer') {
      const n = Number(value);
      if (!Number.isInteger(n)) violations.push(`${fieldLabel(def, data.field)} must be an integer.`);
      else {
        if (data.min !== undefined && n < data.min)
          violations.push(`${fieldLabel(def, data.field)} must be >= ${data.min}.`);
        if (data.max !== undefined && n > data.max)
          violations.push(`${fieldLabel(def, data.field)} must be <= ${data.max}.`);
      }
    }
    if (data.pattern && !new RegExp(data.pattern).test(String(value))) {
      violations.push(`${fieldLabel(def, data.field)} has an invalid format.`);
    }
  }

  if (def.typeFacet?.required && state.types.length === 0) {
    violations.push(`${def.typeFacet.label} is mandatory for a ${def.label}.`);
  }
  if (def.typeFacet) {
    for (const type of state.types) {
      if (!def.typeFacet.classes.includes(type as (typeof def.typeFacet.classes)[number])) {
        violations.push(
          `Unknown ${def.typeFacet.label} "${type}". Allowed: ${def.typeFacet.classes.join(', ')}.`,
        );
      }
    }
  }

  for (const rel of def.relations) {
    if (rel.readOnly || rel.virtual) continue;
    const ids = state.relations[rel.field] ?? [];
    if (rel.required && ids.length === 0 && !options.allowMissingMandatoryRelations)
      violations.push(`A ${def.label} must be linked to at least one ${ENTITY_DEFS[rel.target].label.toLowerCase()}.`);
    if (rel.cardinality === 'one' && ids.length > 1) {
      violations.push(
        `${def.label}.${rel.field} is functional: exactly one ${ENTITY_DEFS[rel.target].label.toLowerCase()} is allowed (received ${ids.length}).`,
      );
    }
    const invalid = ids.filter((id) => {
      try {
        assertSafeId(id);
        return false;
      } catch {
        return true;
      }
    });
    if (invalid.length) violations.push(`Invalid identifiers referenced: ${invalid.join(', ')}.`);

    const targetDef = ENTITY_DEFS[rel.target];
    const existing = await Promise.all(
      ids.map(async (id) => ({ id, ok: id ? await entityRepo.exists(id, targetDef) : false })),
    );
    const missing = existing.filter((e) => !e.ok).map((e) => e.id);
    if (missing.length)
      violations.push(`Unknown ${targetDef.plural.toLowerCase()}: ${missing.join(', ')}.`);
  }

  // unique keys declared with owl:hasKey in the ontology
  for (const data of def.data) {
    if (!data.unique) continue;
    const value = state.data[data.field];
    if (value === undefined || value === null || value === '') continue;
    const matches = await entityRepo.findByDataProperty(def, data.predicate, String(value));
    const others = matches.filter((m) => m.id !== state.id);
    if (others.length) {
      throw conflict(
        `${fieldLabel(def, data.field)} "${String(value)}" is already used by ${others[0]?.id}`,
        { violations: [`${data.predicate} must be unique`], duplicates: others },
      );
    }
  }

  await validateAxioms(def, state, violations);

  if (violations.length) errors(violations);
}

async function validateAxioms(
  def: EntityDef,
  state: ProposedState,
  violations: string[],
): Promise<void> {
  if (def.key === 'doctors') {
    const departmentId = (state.relations['department'] ?? [])[0];
    const specialty = state.types[0];
    if (departmentId && specialty) {
      const expected = SPECIALTY_TO_DEPARTMENT[specialty];
      const types = await typesOfId(departmentId);
      if (expected && !types.includes(expected)) {
        violations.push(
          `A ${specialty} must work in a ${expected} (axiom owl:someValuesFrom :worksIn). Selected department is ${types.filter((t) => t.endsWith('Department')).join(', ') || 'untyped'}.`,
        );
      }
    }
  }

  if (def.key === 'appointments') {
    const departmentId = (state.relations['department'] ?? [])[0];
    const isEmergency = state.types.includes('EmergencyAppointment');
    if (departmentId && isEmergency) {
      const types = await typesOfId(departmentId);
      if (!types.includes('EmergencyDepartment')) {
        violations.push(
          'An EmergencyAppointment must belong to an EmergencyDepartment (axiom owl:someValuesFrom :belongsToDepartment).',
        );
      }
    }
    const status = state.data['status'];
    if (status && !(APPOINTMENT_STATUS as readonly string[]).includes(String(status))) {
      violations.push(`Unknown appointment status "${String(status)}".`);
    }
  }

  if (def.key === 'diseases') {
    if ((state.relations['symptoms'] ?? []).length === 0)
      violations.push('A Disease must declare at least one Symptom (axiom Disease ⊑ ∃hasSymptom.Symptom).');
    if ((state.relations['treatments'] ?? []).length === 0)
      violations.push('A Disease must declare at least one Treatment (axiom Disease ⊑ ∃hasTreatment.Treatment).');
  }

  if (def.key === 'treatments' && state.types.includes('MedicationTreatment')) {
    if ((state.relations['medications'] ?? []).length === 0) {
      violations.push(
        'A MedicationTreatment must use at least one Medication (axiom MedicationTreatment ⊑ ∃usesMedication.Medication).',
      );
    }
  }

  if (def.key === 'departments') {
    const hospitalId = (state.relations['hospital'] ?? [])[0];
    if (!hospitalId)
      violations.push('A MedicalDepartment must be locatedIn exactly one Hospital.');
  }

  void violations;
}

export const typesOfId = async (id: string): Promise<string[]> => {
  const map = await entityRepo.typesOf([asIri(id)]);
  return map.get(asIri(id)) ?? [];
};

/** Delete rules: cascade for patients, 409 with dependents for master data. */
export interface DependencyReport {
  entity: string;
  field: string;
  predicate: string;
  /** field name that is mandatory on the dependent side */
  requiredField: string;
  count: number;
  items: { id: string; label: string }[];
}

export async function findDependents(def: EntityDef, id: string): Promise<DependencyReport[]> {
  const reports: DependencyReport[] = [];
  for (const rel of def.relations) {
    if (rel.virtual) continue;
    // the link only blocks the delete when the *other* side declares it mandatory
    const reverse = ENTITY_DEFS[rel.target].relations.find(
      (r) => r.target === def.key && r.required && !r.virtual,
    );
    if (!reverse) continue;
    const deps = await entityRepo.dependents(def, rel, id);
    if (deps.length > 0) {
      reports.push({
        entity: ENTITY_DEFS[rel.target].key,
        field: rel.field,
        predicate: rel.predicate,
        requiredField: reverse.field,
        count: deps.length,
        items: deps.map((d) => ({ id: d.id, label: d.label })),
      });
    }
  }
  if (def.key === 'medications') {
    // only a MedicationTreatment loses a mandatory :usesMedication link
    for (const rel of def.relations) {
      if (rel.target !== 'treatments') continue;
      const deps = await entityRepo.dependents(def, rel, id);
      const typed = deps.filter((d) => d.type === 'MedicationTreatment');
      if (typed.length > 0)
        reports.push({
          entity: 'treatments',
          field: rel.field,
          predicate: rel.predicate,
          requiredField: 'medications',
          count: typed.length,
          items: typed.map((d) => ({ id: d.id, label: d.label })),
        });
    }
  }
  return dedupe(reports);
}

const dedupe = (reports: DependencyReport[]): DependencyReport[] => {
  const byKey = new Map<string, DependencyReport>();
  for (const report of reports) {
    const key = `${report.entity}:${report.field}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...report, items: [...new Map(report.items.map((i) => [i.id, i])).values()] });
      continue;
    }
    const merged = [...new Map([...existing.items, ...report.items].map((i) => [i.id, i])).values()];
    existing.items = merged;
    existing.count = merged.length;
  }
  return [...byKey.values()];
};

export const dependentConflict = (def: EntityDef, reports: DependencyReport[]): never => {
  throw conflict(
    `Cannot delete ${def.label} ${reports.reduce((acc, r) => acc + r.count, 0)} linked record(s): reassign or delete them first`,
    { violations: reports.map((r) => `${r.count} ${r.entity} reference this ${def.label.toLowerCase()}`), dependents: reports },
  );
};

export const asAppError = (err: unknown): AppError =>
  err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Unexpected error');
