import { sparql } from '../sparql/client';
import { iriToken } from '../sparql/builders';
import { prefixes } from '../sparql/prefixes';
import { assertSafeId } from '../sparql/escape';
import type { EntityDef, EntityKey } from '../ontology/registry';
import type { NormalizedInput } from '../ontology/writer';
import type { Role } from '../auth/model';
import { forbidden } from '../core/errors';
import type { AuthUser } from '../auth/middleware';

/**
 * Allow-list of the fields the restricted roles may write, per entity. Anything
 * missing is reserved for the back office, and an entity with no entry is
 * completely read-only for that role. ADMIN and RECEPTIONIST are unrestricted:
 * their reach is already limited by the permission matrix.
 */
export const WRITABLE_FIELDS: Record<'PATIENT' | 'DOCTOR', Partial<Record<EntityKey, string[]>>> = {
  PATIENT: {
    patients: ['phone', 'gender', 'bloodType'],
    // a patient books but never confirms: status stays back-office only
    appointments: ['date', 'type', 'department', 'patient'],
  },
  DOCTOR: {
    // medical info only: identity and contact data belong to the back office
    patients: ['diseases'],
    appointments: ['status', 'date', 'type', 'department', 'patient'],
    tests: ['date', 'result', 'type', 'patient'],
  },
};

/** Fields this role may write on this entity; 'all' when the role is unrestricted, [] when read-only. */
export const writableFieldsFor = (role: Role, key: EntityKey): string[] | 'all' => {
  if (role === 'ADMIN' || role === 'RECEPTIONIST') return 'all';
  return WRITABLE_FIELDS[role][key] ?? [];
};

/**
 * Fields this role may write on this entity; 'all' when the role is unrestricted, [] when read-only.
 * `type` names the type facet, which the API exposes through the reserved `types` key.
 */
export const assertWritableFields = (
  user: AuthUser,
  def: EntityDef,
  input: NormalizedInput,
): void => {
  if (user.role === 'ADMIN' || user.role === 'RECEPTIONIST') return;
  const allowed = WRITABLE_FIELDS[user.role][def.key];
  if (!allowed) throw forbidden(`${def.plural} are read-only for the ${user.role} role`);
  const touched = [
    ...Object.keys(input.fields ?? {}),
    ...Object.keys(input.relations ?? {}),
    ...(input.types === undefined ? [] : [def.typeFacet?.field ?? 'types']),
  ];
  const denied = touched.filter((f) => !allowed.includes(f));
  if (denied.length > 0)
    throw forbidden(`Reserved field(s) for the ${user.role} role: ${denied.join(', ')}`, {
      violations: denied.map((f) => `${f} can only be changed by the back office`),
    });
};

export const REFERENCE_ENTITIES: EntityKey[] = [
  'diseases',
  'symptoms',
  'treatments',
  'medications',
  'hospitals',
  'departments',
  'doctors',
];

/**
 * Row level security expressed in SPARQL: does this individual belong to the
 * caller's scope (own records for a patient, followed patients for a doctor)?
 */
export async function withinScope(user: AuthUser, def: EntityDef, id: string): Promise<boolean> {
  if (user.role === 'ADMIN' || user.role === 'RECEPTIONIST') return true;

  // professional and reference data carries no patient information
  if (REFERENCE_ENTITIES.includes(def.key)) return true;

  assertSafeId(id);
  if (user.role === 'PATIENT') {
    if (!user.linkedId) return false;
    const self = assertSafeId(user.linkedId);
    if (def.key === 'patients') return id === self;
    const predicate = def.key === 'tests' ? 'isTestOf' : 'appointmentOf';
    return sparql.ask(
      prefixes.withPrefixes(`ASK WHERE { ${iriToken(id)} ${iriToken(predicate)} ${iriToken(self)} }`),
    );
  }

  if (!user.linkedId) return false;
  const doctor = assertSafeId(user.linkedId);
  if (def.key === 'patients')
    return sparql.ask(
      prefixes.withPrefixes(`ASK WHERE { ${iriToken(id)} ${iriToken('treatedBy')} ${iriToken(doctor)} }`),
    );
  if (def.key === 'tests' || def.key === 'appointments') {
    const predicate = def.key === 'tests' ? 'isTestOf' : 'appointmentOf';
    return sparql.ask(
      prefixes.withPrefixes(
        `ASK WHERE { ${iriToken(id)} ${iriToken(predicate)} ?p . ?p ${iriToken('treatedBy')} ${iriToken(doctor)} }`,
      ),
    );
  }
  return true;
}

export async function assertInScope(
  user: AuthUser,
  def: EntityDef,
  id: string,
  action: string,
): Promise<void> {
  if (!(await withinScope(user, def, id)))
    throw forbidden(`This ${def.label.toLowerCase()} is outside the scope of your account (${action})`);
}
