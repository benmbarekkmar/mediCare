import type { EntityDef, EntityKey } from '../ontology/registry';

/** The minimum shape the projection needs: a row with a relation map. */
export interface ProjectionRow {
  relations: Record<string, unknown>;
}

/**
 * Catalogues an anonymous visitor may follow. Appointments, tests and patients
 * stay on the authenticated API even when a hospital or department points at them.
 */
const PUBLIC_TARGETS = new Set<EntityKey>([
  'diseases',
  'symptoms',
  'treatments',
  'medications',
  'hospitals',
  'departments',
  'doctors',
]);

/**
 * Personal and operational clinical data never crosses the anonymous boundary.
 * A hospital page may list its departments and doctors. It must not list the
 * appointments or patients hanging off those units. This lives outside the
 * router so the rule stays testable.
 */
export function publicize<T extends ProjectionRow>(def: EntityDef, item: T): T {
  const hidden = def.relations
    .filter((relation) => !PUBLIC_TARGETS.has(relation.target))
    .map((relation) => relation.field);
  if (hidden.length === 0) return item;
  const relations = { ...item.relations };
  for (const field of hidden) delete relations[field];
  return { ...item, relations } as T;
}
