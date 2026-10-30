import type { EntityDef } from '../ontology/registry';

/** The minimum shape the projection needs: a row with a relation map. */
export interface ProjectionRow {
  relations: Record<string, unknown>;
}

/**
 * Personal data never crosses the anonymous boundary. A disease or a doctor is
 * reference knowledge, but the repository also resolves their links to patients,
 * so every relation whose target is `patients` is dropped before the answer
 * leaves the process. This lives outside the router so the rule stays testable.
 */
export function publicize<T extends ProjectionRow>(def: EntityDef, item: T): T {
  const hidden = def.relations.filter((relation) => relation.target === 'patients').map((relation) => relation.field);
  if (hidden.length === 0) return item;
  const relations = { ...item.relations };
  for (const field of hidden) delete relations[field];
  return { ...item, relations } as T;
}
