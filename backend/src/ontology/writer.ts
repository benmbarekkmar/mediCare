import { sparql } from '../sparql/client';
import { iriOf, localOf, quoted } from '../sparql/escape';
import { iriToken } from '../sparql/builders';
import { prefixes } from '../sparql/prefixes';
import { AppError, badRequest, notFound, unprocessable } from '../core/errors';
import { logger } from '../config/logger';
import type { EntityItem} from '../repos/entity.repo';
import { entityRepo } from '../repos/entity.repo';
import type {
  EntityDef,
  EntityKey} from './registry';
import { entityDef } from './registry';
import { classHumanLabel, closureTypes } from './hierarchy';
import type {
  Overrides} from './derive';
import {
  affectedPatients,
  asIri,
  patientRelationLists,
  planPatientDerivation,
} from './derive';
import { dependentConflict, findDependents, validateEntity } from './validator';
import type { Triple } from './triples';

export interface NormalizedInput {
  fields: Record<string, string | number | null | undefined>;
  types?: string[] | null;
  relations?: Record<string, string[] | null> | null;
  label?: string | null;
  altLabels?: string[] | null;
  /**
   * Intake creation only (patient self-registration): the mandatory object
   * properties of the entity may still be empty at this step. Honoured by
   * `create`, never by `update`, so the next back-office write has to close the
   * record properly.
   */
  pendingClinicalAssignment?: boolean;
}

const RDF_TYPE = `${prefixes.get('rdf')}type`;
const RDFS_LABEL = `${prefixes.get('rdfs')}label`;
const SKOS_ALT = `${prefixes.get('skos')}altLabel`;
const OWL_NAMED = `${prefixes.get('owl')}NamedIndividual`;

const iri = (value: string): Triple['s'] => ({ kind: 'iri', value });

const typeTriple = (subject: string, cls: string): Triple => ({
  s: iri(subject),
  p: iri(RDF_TYPE),
  o: iri(cls === 'NamedIndividual' ? OWL_NAMED : iriOf(cls)),
});

const labelTriple = (subject: string, value: string): Triple => ({
  s: iri(subject),
  p: iri(RDFS_LABEL),
  o: { kind: 'literal', value, datatype: 'string' },
});

const altLabelTriple = (subject: string, value: string): Triple => ({
  s: iri(subject),
  p: iri(SKOS_ALT),
  o: { kind: 'lang', value, lang: 'en' },
});

const pairTriples = (subject: string, predicate: string, object: string, inverse: string): Triple[] => [
  { s: iri(subject), p: iri(predicate), o: iri(object) },
  { s: iri(object), p: iri(inverse), o: iri(subject) },
];

const relationIds = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value))
    return value.map((v) => (typeof v === 'string' ? v : (v as { id?: string })?.id ?? '')).filter(Boolean);
  const single = (value as { id?: string })?.id;
  return single ? [single] : [];
};

const pascal = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
    .slice(0, 60) || 'Item';

const suffixOf = (id: string): string => {
  const match = /(\d+)$/.exec(id);
  return match?.[1] ?? id;
};

const normalizedDateTime = (value: unknown): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    return value.length === 16 ? `${value}:00` : value.slice(0, 19);
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid dateTime value: ${String(value)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, '');
};

export const renderTriple = (t: Triple): string => {
  if (t.p.kind !== 'iri') throw badRequest('Predicate must be an IRI');
  const subject = `<${t.s.value}>`;
  const predicate = `<${t.p.value}>`;
  if (t.o.kind === 'iri') return `${subject} ${predicate} <${t.o.value}>`;
  if (t.o.kind === 'lang') return `${subject} ${predicate} ${quoted(t.o.value)}@${t.o.lang}`;
  switch (t.o.datatype) {
    case 'integer':
      return `${subject} ${predicate} "${Number(t.o.value)}"^^<${prefixes.get('xsd')}integer>`;
    case 'dateTime':
      return `${subject} ${predicate} "${normalizedDateTime(t.o.value)}"^^<${prefixes.get('xsd')}dateTime>`;
    case 'text':
      return `${subject} ${predicate} ${quoted(String(t.o.value))}@en`;
    default:
      return `${subject} ${predicate} ${quoted(String(t.o.value))}`;
  }
};

/** SPARQL needs an explicit `.` between the triples of a block. */
export const tripleBlockOf = (triples: Triple[]): string =>
  triples.length === 0 ? '{ }' : `{\n${triples.map((t) => `  ${renderTriple(t)} .`).join('\n')}\n}`;

/** Several operations in one request: Fuseki commits the whole request as one transaction. */
const compose = (operations: (string | null | undefined)[]): string =>
  operations.filter((op): op is string => Boolean(op)).join('\n;\n');

/** `DELETE/INSERT WHERE {}`: explicit triple set replacement. */
const explicitUpdate = (remove: Triple[], add: Triple[]): string | null =>
  remove.length === 0 && add.length === 0
    ? null
    : `DELETE ${tripleBlockOf(remove)}\nINSERT ${tripleBlockOf(add)}\nWHERE { }`;

/**
 * Every triple that mentions these individuals, as subject or as object. No
 * predicate list: a delete must leave nothing behind, even for vocabulary the
 * registry does not know about.
 */
export const removalOperation = (ids: string[]): string => {
  const targets = ids.map((id) => iriToken(localOf(id))).join(' ');
  return `DELETE { ?sub ?pred ?obj } WHERE {
  VALUES ?target { ${targets} }
  ?sub ?pred ?obj .
  FILTER(?sub = ?target || ?obj = ?target)
}`;
};

const withPrefixes = (update: string): string => prefixes.withPrefixes(update);

interface WriteState {
  id: string;
  types: string[];
  data: Record<string, string | number | null>;
  relations: Record<string, string[]>;
}

/** the patient relation list that this entity kind feeds, used for reassignment on delete */
const patientListKey = (key: EntityKey): 'doctors' | 'diseases' | 'appointments' | null => {
  if (key === 'doctors') return 'doctors';
  if (key === 'diseases') return 'diseases';
  if (key === 'appointments') return 'appointments';
  return null;
};

/**
 * The single writer used by every entity: validates the axioms, materializes the
 * graph (superclasses, inverse pairs, derived patient classes, property chains)
 * and commits everything in one atomic SPARQL Update.
 */
export class OntologyWriter {
  async create(key: EntityKey, input: NormalizedInput): Promise<EntityItem> {
    const def = entityDef(key);
    const id = await this.generateId(def, input);
    const state: WriteState = {
      id,
      types: this.specificTypes(def, input.types ?? undefined),
      data: this.dropEmpty(this.fieldMap(def, input.fields, {})),
      relations: this.relationMap(def, normalizeRelationInput(input.relations), {}),
    };

    await validateEntity(
      def,
      {
        id,
        types: state.types,
        data: state.data,
        relations: state.relations,
      },
      { allowMissingMandatoryRelations: input.pendingClinicalAssignment === true },
    );

    const subject = asIri(id);
    const add: Triple[] = [];
    for (const cls of closureTypes(def.classLocal, state.types)) add.push(typeTriple(subject, cls));
    const label = input.label ?? this.labelFor(def, id, state.data, state.types);
    if (label) add.push(labelTriple(subject, label));
    for (const alt of input.altLabels ?? []) add.push(altLabelTriple(subject, alt));
    for (const [field, value] of Object.entries(state.data))
      if (value !== null) add.push(this.dataTriple(def, subject, field, value));
    for (const rel of def.relations) {
      if (rel.readOnly || rel.virtual) continue;
      for (const target of state.relations[rel.field] ?? [])
        add.push(...pairTriples(subject, iriOf(rel.predicate), asIri(target), iriOf(rel.inverse)));
    }

    const derivation = await this.derivationPlan(def, state);
    await sparql.update(
      withPrefixes(compose([explicitUpdate(derivation.remove, [...add, ...derivation.add])])),
    );
    logger.info({ entity: key, id }, 'individual created');
    return this.fetch(def, id);
  }

  async update(key: EntityKey, id: string, input: NormalizedInput): Promise<EntityItem> {
    const def = entityDef(key);
    const current = await entityRepo.getById(def, id);
    if (!current) throw notFound(`${def.label} ${id} does not exist`);

    const mergedFields: Record<string, string | number | null> = { ...current.fields };
    const state: WriteState = {
      id,
      types:
        input.types !== undefined && input.types !== null
          ? this.specificTypes(def, input.types)
          : this.currentSpecificTypes(def, current.types),
      data: this.dropEmpty(this.fieldMap(def, input.fields, mergedFields)),
      relations: this.relationMap(def, normalizeRelationInput(input.relations), current.relations),
    };

    await validateEntity(def, {
      id,
      types: state.types,
      data: state.data,
      relations: state.relations,
    });

    const subject = current.iri;
    const add: Triple[] = [];
    const remove: Triple[] = [];

    // (a) most specific classes and their superclasses
    const desired = new Set(closureTypes(def.classLocal, state.types));
    for (const cls of desired) if (!current.types.includes(cls)) add.push(typeTriple(subject, cls));
    for (const cls of this.managedClassNames(def))
      if (!desired.has(cls) && current.types.includes(cls)) remove.push(typeTriple(subject, cls));

    // rdfs:label follows the name field
    const label = input.label ?? this.labelFor(def, id, state.data, state.types);
    if (label && current.label !== label) {
      if (current.label) remove.push(labelTriple(subject, current.label));
      add.push(labelTriple(subject, label));
    }

    if (input.altLabels !== undefined && input.altLabels !== null) {
      const existing = await sparql.select(
        prefixes.withPrefixes(`SELECT ?alt WHERE { <${subject}> skos:altLabel ?alt }`),
      );
      for (const row of existing.rows)
        if (row['alt']?.value) remove.push(altLabelTriple(subject, row['alt'].value));
      for (const alt of input.altLabels ?? []) add.push(altLabelTriple(subject, alt));
    }

    // (b) functional data properties: replace, never duplicate
    for (const field of def.data.map((d) => d.field)) {
      if (!(field in input.fields)) continue;
      const before = current.fields[field] ?? null;
      const after = state.data[field] ?? null;
      if (sameValue(before, after)) continue;
      if (before !== null) remove.push(this.dataTriple(def, subject, field, before));
      if (after !== null) add.push(this.dataTriple(def, subject, field, after));
    }

    // (c) object properties, asserted in both directions
    for (const rel of def.relations) {
      if (rel.readOnly || rel.virtual) continue;
      const before = [...relationIds(current.relations[rel.field])].sort();
      const after = [...(state.relations[rel.field] ?? [])].sort();
      if (before.join('|') === after.join('|')) continue;
      for (const target of before.filter((t) => !after.includes(t)))
        remove.push(...pairTriples(subject, iriOf(rel.predicate), asIri(target), iriOf(rel.inverse)));
      for (const target of after.filter((t) => !before.includes(t)))
        add.push(...pairTriples(subject, iriOf(rel.predicate), asIri(target), iriOf(rel.inverse)));
    }

    const derivation = await this.derivationPlan(def, state);
    const operation = explicitUpdate([...remove, ...derivation.remove], [...add, ...derivation.add]);
    await sparql.update(withPrefixes(compose(operation ? [operation] : [])));
    logger.info({ entity: key, id }, 'individual updated');
    return this.fetch(def, id);
  }

  /**
   * Patients cascade to their appointments and tests. Every other entity blocks with
   * 409 and the list of dependents unless `reassignTo` moves them first. The whole
   * delete (reassignment + derived class cleanup + triple removal) is one request.
   */
  async remove(
    key: EntityKey,
    id: string,
    options: { reassignTo?: string } = {},
  ): Promise<{ deleted: string[]; reassigned?: string }> {
    const def = entityDef(key);
    const current = await entityRepo.getById(def, id);
    if (!current) throw notFound(`${def.label} ${id} does not exist`);

    if (def.key === 'patients') {
      const cascaded = def.relations
        .filter((rel) => rel.readOnly && !rel.virtual && (rel.target === 'appointments' || rel.target === 'tests'))
        .flatMap((rel) => relationIds(current.relations[rel.field]));
      const ids = [...new Set([id, ...cascaded])];
      await sparql.update(withPrefixes(removalOperation(ids)));
      logger.info({ entity: key, id, cascaded }, 'individual deleted with cascade');
      return { deleted: ids };
    }

    const reports = await findDependents(def, id);
    if (reports.length > 0 && !options.reassignTo) dependentConflict(def, reports);

    const add: Triple[] = [];
    const removeConcrete: Triple[] = [];
    if (options.reassignTo) {
      if (reports.length === 0) throw badRequest('reassignTo was provided but this individual has no dependents');
      if (options.reassignTo === id) throw badRequest('reassignTo must be a different individual');
      if (!(await entityRepo.exists(options.reassignTo, def)))
        throw notFound(`Reassignment target ${options.reassignTo} does not exist`);
      for (const report of reports) {
        const rel = def.relations.find((r) => `${r.predicate}|${r.field}` === `${report.predicate}|${report.field}`);
        if (!rel) continue;
        for (const dependent of report.items) {
          removeConcrete.push(
            ...pairTriples(asIri(id), iriOf(rel.predicate), asIri(dependent.id), iriOf(rel.inverse)),
          );
          add.push(
            ...pairTriples(
              asIri(options.reassignTo),
              iriOf(rel.predicate),
              asIri(dependent.id),
              iriOf(rel.inverse),
            ),
          );
        }
      }
    }

    // authoritative post-delete patient view, computed before the graph changes
    const affected = await affectedPatients(def, id);
    const lists = await patientRelationLists(affected);
    const listKey = patientListKey(def.key);
    const overrides: Overrides = { patients: {}, exclude: [id] };
    for (const [pid, values] of Object.entries(lists)) {
      overrides.patients![pid] = {
        doctors: substitute(values.doctors, id, listKey === 'doctors' ? options.reassignTo : undefined),
        diseases: substitute(values.diseases, id, listKey === 'diseases' ? options.reassignTo : undefined),
        appointments: substitute(values.appointments, id, listKey === 'appointments' ? options.reassignTo : undefined),
      };
    }
    const plan = await planPatientDerivation(affected, overrides);

    const operations: string[] = [];
    const explicit = explicitUpdate([...removeConcrete, ...plan.remove], [...add, ...plan.add]);
    if (explicit) operations.push(explicit);
    operations.push(removalOperation([id]));
    await sparql.update(withPrefixes(compose(operations)));
    logger.info({ entity: key, id, reassigned: options.reassignTo ?? null }, 'individual deleted');
    return { deleted: [id], reassigned: options.reassignTo };
  }

  async fetch(def: EntityDef, id: string): Promise<EntityItem> {
    const item = await entityRepo.getById(def, id);
    if (!item)
      throw new AppError(500, 'INTERNAL_ERROR', `Write succeeded but ${def.label} ${id} cannot be read back`);
    return item;
  }

  private async generateId(def: EntityDef, input: NormalizedInput): Promise<string> {
    const existing = await this.existingIds(def);
    if (def.idStyle === 'slug') {
      const raw = String(input.fields[def.nameField] ?? input.label ?? '');
      const base = `${def.iriPrefix}${pascal(raw || def.label)}`;
      if (!existing.has(base)) return base;
      let n = 2;
      while (existing.has(`${base}_${n}`)) n += 1;
      return `${base}_${n}`;
    }
    const prefix = this.sequencePrefix(def, input.types?.[0]);
    const re = new RegExp(`^${prefix}(\\d+)$`);
    let max = 0;
    for (const id of existing) {
      const m = re.exec(id);
      if (m?.[1]) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  private sequencePrefix(def: EntityDef, type?: string): string {
    if (def.prefixFromType) {
      if (!type)
        throw unprocessable(`${def.typeFacet?.label ?? 'Type'} is mandatory to create a ${def.label}`, {
          violations: [
            `${def.typeFacet?.label ?? 'Type'} is mandatory: it names the identifier of a ${def.label}`,
          ],
        });
      return `${type}_`;
    }
    return def.iriPrefix;
  }

  private async existingIds(def: EntityDef): Promise<Set<string>> {
    const { rows } = await sparql.select(
      prefixes.withPrefixes(`SELECT ?s WHERE { ?s rdf:type ${iriToken(def.classLocal)} }`),
    );
    return new Set(rows.map((r) => localOf(r['s']?.value ?? '')).filter(Boolean));
  }

  private specificTypes(def: EntityDef, types: string[] | undefined): string[] {
    if (!def.typeFacet) return [];
    const provided = (types ?? []).filter(Boolean);
    if (!def.typeFacet.multiple && provided.length > 1)
      throw badRequest(`${def.typeFacet.label} accepts a single value for a ${def.label}`);
    return [...new Set(provided)];
  }

  private currentSpecificTypes(def: EntityDef, types: string[]): string[] {
    if (!def.typeFacet) return [];
    const allowed = def.typeFacet.classes as readonly string[];
    return types.filter((t) => allowed.includes(t));
  }

  /**
   * Classes this write owns outright. Derived patient classes are excluded:
   * the derivation plan is their single authority.
   */
  private managedClassNames(def: EntityDef): string[] {
    if (def.typeFacet) return [...def.typeFacet.classes, def.classLocal, 'NamedIndividual'];
    return [def.classLocal, 'NamedIndividual'];
  }

  private relationMap(
    def: EntityDef,
    input: Record<string, string[]>,
    current: EntityItem['relations'],
  ): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const rel of def.relations) {
      if (rel.readOnly || rel.virtual) continue;
      out[rel.field] = rel.field in input ? (input[rel.field] ?? []) : relationIds(current[rel.field]);
    }
    return out;
  }

  private fieldMap(
    def: EntityDef,
    input: Record<string, string | number | null | undefined>,
    current: Record<string, string | number | null>,
  ): Record<string, string | number | null> {
    const out: Record<string, string | number | null> = { ...current };
    for (const data of def.data) {
      const value = input[data.field];
      if (value === undefined) continue;
      if (value === null || value === '') delete out[data.field];
      else out[data.field] = value;
    }
    return out;
  }

  private dropEmpty(fields: Record<string, string | number | null>): Record<string, string | number | null> {
    const out: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === '') continue;
      out[key] = value;
    }
    return out;
  }

  private dataTriple(def: EntityDef, subject: string, field: string, value: string | number): Triple {
    const data = def.data.find((d) => d.field === field);
    if (!data) throw badRequest(`Unknown field ${field} for ${def.label}`);
    return {
      s: iri(subject),
      p: iri(iriOf(data.predicate)),
      o: { kind: 'literal', value, datatype: data.datatype },
    };
  }

  private labelFor(
    def: EntityDef,
    id: string,
    data: Record<string, string | number | null>,
    types: string[],
  ): string {
    if (def.nameField !== 'label') {
      const name = data[def.nameField];
      if (name) return def.key === 'doctors' ? `Dr. ${String(name)}` : String(name);
    }
    if (def.key === 'appointments') return `Appointment ${suffixOf(id)}`;
    if (types[0]) return `${classHumanLabel(types[0])} ${suffixOf(id)}`;
    return id;
  }

  /** Recomputes the materialized patient view for everything this write touches. */
  private async derivationPlan(def: EntityDef, state: WriteState): Promise<{ add: Triple[]; remove: Triple[] }> {
    const skip: EntityKey[] = ['tests', 'symptoms', 'treatments', 'medications'];
    if (skip.includes(def.key)) return { add: [], remove: [] };

    const overrides: Overrides = { patients: {} };
    const patientIds: string[] = [];

    if (def.key === 'patients') {
      const age = state.data['age'] === undefined ? undefined : Number(state.data['age']);
      // appointments are asserted from the appointment side, so the graph list stays authoritative
      overrides.patients![state.id] = {
        age: Number.isFinite(age) ? age : undefined,
        doctors: state.relations['doctors'] ?? [],
        diseases: state.relations['diseases'] ?? [],
      };
      patientIds.push(state.id);
    } else {
      // links asserted by this write are not in the graph yet, so the patients they
      // target would otherwise be missed on create
      const asserted = def.relations
        .filter((rel) => rel.target === 'patients')
        .flatMap((rel) => state.relations[rel.field] ?? []);
      const linked = [...new Set([...(await affectedPatients(def, state.id)).map(localOf), ...asserted])];
      const lists = await patientRelationLists(linked);
      for (const [pid, values] of Object.entries(lists)) {
        overrides.patients![pid] = {
          doctors: relTargetField(def) === 'doctors' ? recompute(values.doctors, state.id, state.relations) : values.doctors,
          diseases: relTargetField(def) === 'diseases' ? recompute(values.diseases, state.id, state.relations) : values.diseases,
          appointments:
            def.key === 'appointments'
              ? [...new Set([...values.appointments.filter((a) => a !== state.id), state.id])]
              : values.appointments,
        };
        patientIds.push(pid);
      }
      if (def.key === 'diseases') overrides.diseaseTypes = { [state.id]: state.types };
      if (def.key === 'appointments') overrides.appointmentTypes = { [state.id]: state.types };
      if (def.key === 'doctors') {
        const department = state.relations['department']?.[0];
        if (department) overrides.doctorDepartment = { [state.id]: department };
      }
      if (def.key === 'departments') {
        const hospital = state.relations['hospital']?.[0];
        if (hospital) overrides.departmentHospital = { [state.id]: hospital };
      }
    }

    return planPatientDerivation(patientIds, overrides);
  }
}

const relTargetField = (def: EntityDef): 'doctors' | 'diseases' | null => {
  if (def.key === 'doctors') return 'doctors';
  if (def.key === 'diseases') return 'diseases';
  return null;
};

/** drop the edited individual from a patient list and add the authoritative new links */
function recompute(list: string[], self: string, relations: Record<string, string[]>): string[] {
  const replacement = Object.values(relations).flat();
  return [...new Set([...list.filter((v) => v !== self), ...replacement])];
}

/** remove the deleted individual, optionally replaced by the reassignment target */
function substitute(list: string[], removed: string, replacement?: string): string[] {
  const kept = list.filter((v) => v !== removed);
  if (replacement && kept.length !== list.length) kept.push(replacement);
  return [...new Set(kept)];
}

const normalizeRelationInput = (
  input: Record<string, string[] | null> | null | undefined,
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input ?? {}))
    if (value !== null && value !== undefined) out[key] = value;
  return out;
};

const sameValue = (a: string | number | null, b: string | number | null): boolean => {
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  if (String(a) === String(b)) return true;
  // two dateTimes that differ only by seconds/offset are the same instant
  const left = dateTimeOf(String(a));
  const right = dateTimeOf(String(b));
  return left !== null && left === right;
};

const dateTimeOf = (value: string): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(value);
  return m?.[1] ?? null;
};

export const ontologyWriter = new OntologyWriter();
