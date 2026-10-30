import type { ResultValue } from '../sparql/client';
import { sparql } from '../sparql/client';
import { localOf } from '../sparql/escape';
import { iriToken } from '../sparql/builders';
import { prefixes } from '../sparql/prefixes';
import type { EntityDef } from './registry';
import type { Triple} from './triples';
import { iriTerm, nsTerm } from './triples';
import { ageClassFor } from './hierarchy';

export const PATIENT_DERIVED_CLASSES = [
  'ChildPatient',
  'AdultPatient',
  'ElderlyPatient',
  'ChronicPatient',
  'EmergencyPatient',
] as const;

const ONT = prefixes.get('ont') as string;

/**
 * Authoritative post-write values the graph does not reflect yet: the derivation
 * reads the current triples, overlays these, and emits the delta inside the same
 * atomic SPARQL Update.
 */
export interface PatientOverride {
  age?: number;
  doctors?: string[];
  diseases?: string[];
  appointments?: string[];
}

export interface Overrides {
  patients?: Record<string, PatientOverride>;
  /** appointment id -> asserted classes (needed for individuals not stored yet) */
  appointmentTypes?: Record<string, string[]>;
  /** disease id -> asserted classes */
  diseaseTypes?: Record<string, string[]>;
  /** doctor id -> department id (when worksIn is being changed) */
  doctorDepartment?: Record<string, string>;
  /** department id -> hospital id (when locatedIn is being changed) */
  departmentHospital?: Record<string, string>;
  /** individuals treated as already deleted (delete operations) */
  exclude?: string[];
}

type Rows = Record<string, ResultValue | undefined>[];

const run = async (query: string): Promise<Rows> =>
  (await sparql.select(prefixes.withPrefixes(query))).rows;

export const asIri = (idOrIri: string): string =>
  idOrIri.startsWith('http') ? idOrIri : `${ONT}${idOrIri}`;

const collect = (rows: Rows, from: string, to: string): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const key = row[from]?.value;
    const value = row[to]?.value;
    if (!key || !value) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(value);
  }
  return map;
};

/**
 * `rdf:type` bindings come back as full IRIs and include the anonymous
 * restriction classes as blank nodes; the derivation works on ontology local
 * names only.
 */
const collectTypes = (rows: Rows, from: string, to: string): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const key = row[from]?.value;
    const type = row[to];
    if (!key || type?.type !== 'uri') continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(localOf(type.value));
  }
  return map;
};

const pushTriple = (bucket: Triple[], subject: string, predicate: string, object: string): void => {
  bucket.push({
    s: { kind: 'iri', value: subject },
    p: predicate === 'rdf:type' ? nsTerm('rdf:type') : iriTerm(predicate),
    o: { kind: 'iri', value: asIri(object) },
  });
};

const valuesList = (iris: string[]): string => iris.map((i) => `<${i}>`).join(' ');

/** Reads the graph, overlays pending changes, returns triples to add and remove. */
export async function planPatientDerivation(
  patientIds: string[],
  overrides: Overrides = {},
): Promise<{ add: Triple[]; remove: Triple[] }> {
  const unique = [...new Set(patientIds.filter(Boolean).map(asIri))];
  if (unique.length === 0) return { add: [], remove: [] };
  const list = valuesList(unique);
  const excluded = new Set((overrides.exclude ?? []).map(asIri));

  const [ageRows, diseaseRows, appointmentRows, doctorRows, currentRows] = await Promise.all([
    run(`SELECT ?p ?age WHERE { VALUES ?p { ${list} } OPTIONAL { ?p ${iriToken('hasAge')} ?age } }`),
    run(`SELECT DISTINCT ?p ?d WHERE { VALUES ?p { ${list} } ?p ${iriToken('hasDisease')} ?d }`),
    run(`SELECT DISTINCT ?p ?a WHERE { VALUES ?p { ${list} } ?p ${iriToken('hasAppointment')} ?a }`),
    run(
      `SELECT DISTINCT ?p ?doc WHERE { VALUES ?p { ${list} } { ?p ${iriToken('treatedBy')} ?doc } UNION { ?doc ${iriToken('treats')} ?p } }`,
    ),
    run(`SELECT ?p ?t ?dep ?hos WHERE {
          VALUES ?p { ${list} }
          OPTIONAL { ?p rdf:type ?t . FILTER(?t IN (${PATIENT_DERIVED_CLASSES.map((c) => iriToken(c)).join(', ')})) }
          OPTIONAL { ?p ${iriToken('followedInDepartment')} ?dep }
          OPTIONAL { ?p ${iriToken('followedInHospital')} ?hos }
        }`),
  ]);

  const graphAge = new Map<string, number | undefined>();
  for (const row of ageRows) {
    const p = row['p']?.value;
    if (p) graphAge.set(p, row['age']?.value === undefined ? undefined : Number(row['age'].value));
  }
  const graphDiseases = collect(diseaseRows, 'p', 'd');
  const graphAppointments = collect(appointmentRows, 'p', 'a');
  const graphDoctors = collect(doctorRows, 'p', 'doc');

  const derivedTypes = new Map<string, string[]>();
  const storedDeptLinks = new Map<string, string[]>();
  const storedHospLinks = new Map<string, string[]>();
  for (const row of currentRows) {
    const p = row['p']?.value;
    if (!p) continue;
    const type = row['t']?.type === 'uri' ? localOf(row['t'].value) : undefined;
    if (type) {
      if (!derivedTypes.has(p)) derivedTypes.set(p, []);
      derivedTypes.get(p)?.push(type);
    }
    const dep = row['dep']?.value;
    if (dep) {
      if (!storedDeptLinks.has(p)) storedDeptLinks.set(p, []);
      storedDeptLinks.get(p)?.push(dep);
    }
    const hos = row['hos']?.value;
    if (hos) {
      if (!storedHospLinks.has(p)) storedHospLinks.set(p, []);
      storedHospLinks.get(p)?.push(hos);
    }
  }

  // authoritative per patient relation lists (graph + pending overlay)
  const filterExcluded = (iris: string[]): string[] => iris.filter((i) => !excluded.has(i));
  const perPatient = unique.map((iri) => {
    const id = localOf(iri);
    const override = overrides.patients?.[id] ?? {};
    const diseases = (override.diseases ?? (graphDiseases.get(iri) ?? []).map(localOf)).map(asIri);
    const appointments = (override.appointments ?? (graphAppointments.get(iri) ?? []).map(localOf)).map(asIri);
    const doctors = (override.doctors ?? (graphDoctors.get(iri) ?? []).map(localOf)).map(asIri);
    return {
      iri,
      id,
      age: override.age ?? graphAge.get(iri),
      diseases: filterExcluded(diseases),
      appointments: filterExcluded(appointments),
      doctors: filterExcluded(doctors),
    };
  });

  const relatedIris = [...new Set(perPatient.flatMap((p) => [...p.diseases, ...p.appointments, ...p.doctors]))];
  const typesByIri = relatedIris.length
    ? collectTypes(
        await run(`SELECT DISTINCT ?x ?t WHERE { VALUES ?x { ${valuesList(relatedIris)} } ?x rdf:type ?t }`),
        'x',
        't',
      )
    : new Map<string, string[]>();

  // :followedInDepartment = treatedBy o worksIn, :followedInHospital = that o locatedIn.
  // resolved from the doctor side so brand new patients (no stored treatedBy yet) are handled.
  const doctorIris = [...new Set(perPatient.flatMap((p) => p.doctors))];
  const doctorChain = await chainsFromDoctors(doctorIris, excluded);
  const departmentIris = [...new Set([
    ...[...doctorChain.values()].flatMap((chain) => (chain.department ? [chain.department] : [])),
    ...Object.values(overrides.doctorDepartment ?? {}).map(asIri),
    ...Object.keys(overrides.departmentHospital ?? {}).map(asIri),
  ])];
  const hospitalsByDepartment = await hospitalsFromDepartments(departmentIris);

  const typesFor = (iri: string, overrideMap?: Record<string, string[]>): string[] => {
    const id = localOf(iri);
    return overrideMap?.[id] ?? overrideMap?.[iri] ?? typesByIri.get(iri) ?? [];
  };

  const add: Triple[] = [];
  const remove: Triple[] = [];

  for (const patient of perPatient) {
    const { iri, age, diseases, appointments, doctors } = patient;

    const diseaseTypes = new Set(diseases.flatMap((d) => typesFor(d, overrides.diseaseTypes)));
    const appointmentTypes = new Set(appointments.flatMap((a) => typesFor(a, overrides.appointmentTypes)));

    const desired = new Set<string>();
    if (age !== undefined && Number.isFinite(age)) desired.add(ageClassFor(age));
    if (diseaseTypes.has('ChronicDisease')) desired.add('ChronicPatient');
    if (appointmentTypes.has('EmergencyAppointment')) desired.add('EmergencyPatient');

    const stored = derivedTypes.get(iri) ?? [];
    for (const cls of PATIENT_DERIVED_CLASSES) {
      const want = desired.has(cls);
      const has = stored.includes(cls);
      if (want && !has) pushTriple(add, iri, 'rdf:type', cls);
      if (!want && has) pushTriple(remove, iri, 'rdf:type', cls);
    }

    const departmentIds = new Set<string>();
    const hospitalIds = new Set<string>();
    for (const docIri of doctors) {
      const docId = localOf(docIri);
      const overrideDep = overrides.doctorDepartment?.[docId];
      const fromGraph = doctorChain.get(docIri);
      const dep = overrideDep ? asIri(overrideDep) : fromGraph?.department;
      if (!dep || excluded.has(dep)) continue;
      departmentIds.add(dep);
      const overrideHos = overrides.departmentHospital?.[localOf(dep)];
      const hos = overrideHos ? asIri(overrideHos) : hospitalsByDepartment.get(dep);
      if (hos && !excluded.has(hos)) hospitalIds.add(hos);
    }
    syncLinks(add, remove, iri, 'followedInDepartment', departmentIds, storedDeptLinks.get(iri) ?? []);
    syncLinks(add, remove, iri, 'followedInHospital', hospitalIds, storedHospLinks.get(iri) ?? []);
  }

  return { add, remove };
}

/** Both stored directions of `treatedBy` for the given patients. */
async function chainsFromDoctors(
  doctorIris: string[],
  excluded: Set<string>,
): Promise<Map<string, { department?: string; hospital?: string }>> {
  const out = new Map<string, { department?: string; hospital?: string }>();
  const docs = doctorIris.filter((d) => !excluded.has(d));
  if (docs.length === 0) return out;
  const rows = await run(`SELECT DISTINCT ?doc ?dep ?h WHERE {
      VALUES ?doc { ${valuesList(docs)} }
      OPTIONAL { { ?doc ${iriToken('worksIn')} ?dep } UNION { ?dep ${iriToken('hasDoctor')} ?doc } }
      OPTIONAL { { ?dep ${iriToken('locatedIn')} ?h } UNION { ?h ${iriToken('hasDepartment')} ?dep } }
    }`);
  for (const row of rows) {
    const doc = row['doc']?.value;
    if (!doc) continue;
    const dep = row['dep']?.value;
    const hos = row['h']?.value;
    const previous = out.get(doc) ?? {};
    out.set(doc, {
      department: previous.department ?? (dep && !excluded.has(dep) ? dep : undefined),
      hospital: previous.hospital ?? (hos && !excluded.has(hos) ? hos : undefined),
    });
  }
  return out;
}

/** Resolve the hospital from the selected department, including a pending doctor move. */
async function hospitalsFromDepartments(departmentIris: string[]): Promise<Map<string, string>> {
  if (departmentIris.length === 0) return new Map();
  const rows = await run(`SELECT DISTINCT ?dep ?h WHERE {
      VALUES ?dep { ${valuesList(departmentIris)} }
      { ?dep ${iriToken('locatedIn')} ?h } UNION { ?h ${iriToken('hasDepartment')} ?dep }
    }`);
  const out = new Map<string, string>();
  for (const row of rows) {
    const dep = row['dep']?.value;
    const hospital = row['h']?.value;
    if (dep && hospital && !out.has(dep)) out.set(dep, hospital);
  }
  return out;
}

function syncLinks(
  add: Triple[],
  remove: Triple[],
  subject: string,
  predicate: string,
  desired: Set<string>,
  storedIris: string[],
): void {
  const stored = new Set(storedIris.filter((i) => i.startsWith('http')));
  for (const target of desired) if (!stored.has(target)) pushTriple(add, subject, predicate, target);
  for (const target of stored) if (!desired.has(target)) pushTriple(remove, subject, predicate, target);
}

/** Patients whose derived triples may change when this entity is written. */
export async function affectedPatients(def: EntityDef, idOrIri: string): Promise<string[]> {
  const iri = asIri(idOrIri);
  if (def.key === 'patients') return [iri];

  const patientType = iriToken('Patient');
  const token = `<${iri}>`;
  const queries: Partial<Record<EntityDef['key'], string>> = {
    appointments: `SELECT DISTINCT ?p WHERE { { ${token} ${iriToken('appointmentOf')} ?p } UNION { ?p ${iriToken('hasAppointment')} ${token} } ?p rdf:type ${patientType} }`,
    tests: `SELECT DISTINCT ?p WHERE { { ${token} ${iriToken('isTestOf')} ?p } UNION { ?p ${iriToken('undergoesTest')} ${token} } ?p rdf:type ${patientType} }`,
    diseases: `SELECT DISTINCT ?p WHERE { { ${token} ${iriToken('isDiseaseOf')} ?p } UNION { ?p ${iriToken('hasDisease')} ${token} } ?p rdf:type ${patientType} }`,
    doctors: `SELECT DISTINCT ?p WHERE { { ${token} ${iriToken('treats')} ?p } UNION { ?p ${iriToken('treatedBy')} ${token} } ?p rdf:type ${patientType} }`,
    departments: `SELECT DISTINCT ?p WHERE {
        { ?doc ${iriToken('worksIn')} ${token} } UNION { ${token} ${iriToken('hasDoctor')} ?doc }
        { ?p ${iriToken('treatedBy')} ?doc } UNION { ?doc ${iriToken('treats')} ?p }
        ?p rdf:type ${patientType} }`,
    hospitals: `SELECT DISTINCT ?p WHERE {
        { ?dep ${iriToken('locatedIn')} ${token} } UNION { ${token} ${iriToken('hasDepartment')} ?dep }
        { ?doc ${iriToken('worksIn')} ?dep } UNION { ?dep ${iriToken('hasDoctor')} ?doc }
        { ?p ${iriToken('treatedBy')} ?doc } UNION { ?doc ${iriToken('treats')} ?p }
        ?p rdf:type ${patientType} }`,
  };

  const query = queries[def.key];
  if (!query) return [];
  const rows = await run(query);
  return [...new Set(rows.map((r) => r['p']?.value).filter((v): v is string => Boolean(v)))];
}

/** Full relation lists of the given patients, used to build authoritative overrides. */
export async function patientRelationLists(
  patientIds: string[],
): Promise<Record<string, { doctors: string[]; diseases: string[]; appointments: string[]; age?: number }>> {
  const iris = [...new Set(patientIds.map(asIri))];
  if (iris.length === 0) return {};
  const list = valuesList(iris);
  const [doctorRows, diseases, appointments, ages] = await Promise.all([
    run(`SELECT ?p ?v WHERE { VALUES ?p { ${list} } ?p ${iriToken('treatedBy')} ?v }`),
    run(`SELECT ?p ?v WHERE { VALUES ?p { ${list} } ?p ${iriToken('hasDisease')} ?v }`),
    run(`SELECT ?p ?v WHERE { VALUES ?p { ${list} } ?p ${iriToken('hasAppointment')} ?v }`),
    run(`SELECT ?p ?v WHERE { VALUES ?p { ${list} } OPTIONAL { ?p ${iriToken('hasAge')} ?v } }`),
  ]);
  const dMap = collect(doctorRows, 'p', 'v');
  const disMap = collect(diseases, 'p', 'v');
  const aMap = collect(appointments, 'p', 'v');
  const ageMap = new Map<string, number | undefined>();
  for (const row of ages) {
    const p = row['p']?.value;
    if (p) ageMap.set(p, row['v']?.value === undefined ? undefined : Number(row['v'].value));
  }
  const out: Record<string, { doctors: string[]; diseases: string[]; appointments: string[]; age?: number }> = {};
  for (const iri of iris) {
    out[localOf(iri)] = {
      doctors: (dMap.get(iri) ?? []).map(localOf),
      diseases: (disMap.get(iri) ?? []).map(localOf),
      appointments: (aMap.get(iri) ?? []).map(localOf),
      age: ageMap.get(iri),
    };
  }
  return out;
}
