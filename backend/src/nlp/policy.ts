import { forbidden } from '../core/errors';
import { NAMESPACES } from '../sparql/prefixes';
import type { NlpParse } from './client';

export type Access = 'general' | 'own' | 'staff';

/** Roots whose individuals are personal records, never public knowledge. */
const PRIVATE_ROOTS = ['Patient', 'MedicalTest', 'MedicalAppointment'];

/**
 * What each intent may be asked by a signed in patient. Unknown and forgotten
 * intents are staff only, so a new template is denied until it is reviewed.
 */
const PATIENT_ACCESS: Record<string, Access> = {
  disease_symptoms: 'general',
  disease_treatments: 'general',
  disease_medications: 'general',
  disease_description: 'general',
  symptom_diseases: 'general',
  medication_dosage: 'general',
  medications_by_class: 'general',
  treatment_medications: 'general',
  treatment_duration: 'general',
  doctors_by_specialty: 'general',
  department_doctors: 'general',
  department_hospital: 'general',
  hospital_departments: 'general',
  hospital_doctors: 'general',
  hospitals_by_type: 'general',
  hospitals_by_department_type: 'general',
  search_by_keyword: 'general',
  top_diseases_by_patients: 'general',
  ask_boolean: 'own',
  describe_individual: 'own',
  list_instances: 'own',
  count_instances: 'own',
  patient_diseases: 'own',
  patient_doctor: 'own',
  patient_tests: 'own',
  patient_appointments: 'own',
  followed_in_hospital: 'own',
};

const PATIENT_LOCAL = `${NAMESPACES.ont}Patient_`;

export const isPatientIri = (value: string): boolean => value.startsWith(PATIENT_LOCAL);

const localOf = (iri: string): string => iri.slice(iri.indexOf('#') + 1);

/** The ontology local name of a bound patient IRI, used to scope doctor answers. */
export const patientLocalOf = (value: unknown): string | null => {
  const text = String(value ?? '');
  return isPatientIri(text) ? localOf(text) : null;
};

/** A listing question about patients, tests or appointments is not general knowledge. */
function privateListing(plan: NlpParse): boolean {
  const cls = String(plan.slots['class'] ?? '');
  return PRIVATE_ROOTS.some((root) => cls === root || cls.startsWith(root));
}

export function accessFor(plan: NlpParse): Access {
  if (plan.intent === 'not_understood') return 'general';
  if (plan.intent === 'list_instances' || plan.intent === 'count_instances')
    return privateListing(plan) ? 'staff' : 'general';
  if (plan.intent === 'describe_individual') {
    // a record of a person is personal data, a hospital or a disease is knowledge
    const person = ['patient', 'doctor', 'appointment', 'test'].some((slot) => Boolean(plan.slots[slot]));
    return person ? 'own' : 'general';
  }
  return PATIENT_ACCESS[plan.intent] ?? 'staff';
}

/**
 * The question a patient is allowed to have answered, with their own individual in
 * place of the one they named. The check runs on the parsed plan and again on the
 * generated query, so neither a wrong slot nor a hand edited SPARQL can escape it.
 */
export function guardForPatient(plan: NlpParse, ownLocal: string | null): void {
  const access = accessFor(plan);
  if (access === 'staff')
    throw forbidden('The assistant does not answer that kind of question for a patient account');
  if (access === 'general') return;
  if (!ownLocal) throw forbidden('This account is not linked to a patient record');
  const named = plan.slots['patient'];
  if (named && named !== ownLocal)
    throw forbidden('You may only ask about your own medical record');
  const ownIri = `${NAMESPACES.ont}${ownLocal}`;
  for (const match of plan.sparql.matchAll(/<[^>]*#Patient_[A-Za-z0-9_]+>/g)) {
    if (match[0].slice(1, -1) !== ownIri)
      throw forbidden('The generated query reaches a patient record that is not yours');
  }
}

/** Rows a doctor may see: any row that mentions a patient they do not follow is dropped. */
export function ownPatientFilter(ownLocals: Set<string>) {
  return (rows: Record<string, string>[]): Record<string, string>[] =>
    rows.filter((row) =>
      Object.values(row).every((value) => {
        const local = patientLocalOf(value);
        return local === null || ownLocals.has(local);
      }),
    );
}
