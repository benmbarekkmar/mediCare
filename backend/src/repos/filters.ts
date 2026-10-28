import { assertSafeId } from '../sparql/escape';
import { iriToken } from '../sparql/builders';
import { badRequest } from '../core/errors';
import type {
  EntityDef} from '../ontology/registry';
import {
  DISEASE_CATEGORIES,
  SPECIALTIES,
} from '../ontology/registry';

/** Validates a value against a closed set, returning the canonical spelling. */
export function enumValue(raw: string, allowed: readonly string[], param: string): string {
  const hit = allowed.find((a) => a.toLowerCase() === raw.toLowerCase().replace(/\s+/g, ''));
  if (!hit) throw badRequest(`Invalid value "${raw}" for ${param}. Allowed: ${allowed.join(', ')}`);
  return hit;
}

export const idValue = (raw: string, param: string): string => {
  try {
    return assertSafeId(raw);
  } catch {
    throw badRequest(`Invalid identifier for ${param}: ${raw}`);
  }
};

const truthy = (v: string | undefined): boolean => v === 'true' || v === '1' || v === 'yes';

const XSD_DT = 'http://www.w3.org/2001/XMLSchema#dateTime';

export function dateTimeLiteral(raw: string, param: string, endOfDay = false): string {
  let value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value = `${value}T${endOfDay ? '23:59:59' : '00:00:00'}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid date for ${param}: ${raw}`);
  return `"${value.replace(/\.\d{3}Z$/, '')}"^^<${XSD_DT}>`;
}

const exists = (body: string): string => `FILTER EXISTS { ${body} }`;
const typeIs = (cls: string): string => exists(`?s rdf:type ${iriToken(cls)}`);
const linkIs = (predicate: string, id: string): string =>
  exists(`?s ${iriToken(predicate)} ${iriToken(idValue(id, predicate))}`);
const linkThrough = (predicate: string, middleVar: string, secondPredicate: string, id: string): string =>
  exists(`?s ${iriToken(predicate)} ${middleVar} . ${middleVar} ${iriToken(secondPredicate)} ${iriToken(idValue(id, secondPredicate))}`);

const dateFilters = (from: string | undefined, to: string | undefined, varName: string): string[] => {
  const out: string[] = [];
  if (from) out.push(`FILTER(BOUND(${varName}) && ${varName} >= ${dateTimeLiteral(from, 'dateFrom')})`);
  if (to) out.push(`FILTER(BOUND(${varName}) && ${varName} <= ${dateTimeLiteral(to, 'dateTo', true)})`);
  return out;
};

const typeFacetParam = (def: EntityDef, raw: string, param: string): string => {
  const classes = def.typeFacet?.classes ?? [];
  const cls = enumValue(raw, classes, param);
  return typeIs(cls);
};

/**
 * Entity specific `FILTER EXISTS` fragments. Wrapping every condition in
 * FILTER EXISTS keeps exactly one row per individual (no cross products) and
 * never interpolates raw user text into a triple pattern.
 */
export function buildFilters(def: EntityDef, params: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  const get = (name: string): string | undefined => {
    const v = params[name];
    return v === undefined || v === '' ? undefined : v;
  };

  const ids = get('ids');
  if (ids) {
    const list = ids
      .split(',')
      .map((s) => idValue(s.trim(), 'ids'))
      .filter(Boolean);
    if (list.length > 0) out.push(`VALUES ?s { ${list.map(iriToken).join(' ')} }`);
  }

  // equality on value-set data properties (already projected as OPTIONAL patterns)
  for (const data of def.data) {
    const raw = get(data.field);
    if (!raw || !data.values) continue;
    const value = enumValue(raw, data.values, data.field);
    out.push(`FILTER(BOUND(?__${data.field}) && ?__${data.field} = "${value}")`);
  }

  switch (def.key) {
    case 'patients': {
      const ageGroup = get('ageGroup');
      if (ageGroup) {
        const cls = AGE_ALIASES[ageGroup.toLowerCase()] ?? AGE_ALIASES[ageGroup];
        if (!cls)
          throw badRequest(`Invalid ageGroup "${ageGroup}". Allowed: child, adult, elderly, chronic, emergency`);
        out.push(typeIs(cls));
      }
      if (truthy(get('chronic'))) out.push(typeIs('ChronicPatient'));
      if (truthy(get('emergency'))) out.push(typeIs('EmergencyPatient'));
      const disease = get('disease');
      if (disease) out.push(linkIs('hasDisease', disease));
      const doctor = get('doctor');
      if (doctor) out.push(linkIs('treatedBy', doctor));
      const department = get('department');
      if (department) out.push(linkIs('followedInDepartment', department));
      const hospital = get('hospital');
      if (hospital) out.push(linkIs('followedInHospital', hospital));
      const minAge = get('minAge');
      if (minAge) out.push(`FILTER(BOUND(?__age) && ?__age >= ${asInt(minAge, 'minAge')})`);
      const maxAge = get('maxAge');
      if (maxAge) out.push(`FILTER(BOUND(?__age) && ?__age <= ${asInt(maxAge, 'maxAge')})`);
      break;
    }
    case 'doctors': {
      const specialty = get('specialty');
      if (specialty) out.push(typeIs(enumValue(specialty, SPECIALTIES, 'specialty')));
      const department = get('department');
      if (department) out.push(linkIs('worksIn', department));
      const hospital = get('hospital');
      if (hospital) out.push(linkThrough('worksIn', '?__dep', 'locatedIn', hospital));
      const patient = get('patient');
      if (patient) out.push(linkIs('treats', patient));
      break;
    }
    case 'diseases': {
      const category = get('category');
      if (category) out.push(typeIs(enumValue(category, [...DISEASE_CATEGORIES, 'Disease'], 'category')));
      const patient = get('patient');
      if (patient) out.push(linkIs('isDiseaseOf', patient));
      const symptom = get('symptom');
      if (symptom) out.push(linkIs('hasSymptom', symptom));
      const treatment = get('treatment');
      if (treatment) out.push(linkIs('hasTreatment', treatment));
      break;
    }
    case 'symptoms': {
      const type = get('type');
      if (type) out.push(typeFacetParam(def, type, 'type'));
      const disease = get('disease');
      if (disease) out.push(linkIs('isSymptomOf', disease));
      break;
    }
    case 'treatments': {
      const type = get('type');
      if (type) out.push(typeFacetParam(def, type, 'type'));
      const disease = get('disease');
      if (disease) out.push(linkIs('isTreatmentOf', disease));
      const medication = get('medication');
      if (medication) out.push(linkIs('usesMedication', medication));
      break;
    }
    case 'medications': {
      const cls = get('class');
      if (cls) out.push(typeFacetParam(def, cls, 'class'));
      const treatment = get('treatment');
      if (treatment) out.push(linkIs('isUsedIn', treatment));
      break;
    }
    case 'tests': {
      const type = get('type');
      if (type) out.push(typeFacetParam(def, type, 'type'));
      const patient = get('patient');
      if (patient) out.push(linkIs('isTestOf', patient));
      const doctor = get('doctor');
      if (doctor) out.push(linkThrough('isTestOf', '?__p', 'treatedBy', doctor));
      out.push(...dateFilters(get('dateFrom'), get('dateTo'), '?__date'));
      break;
    }
    case 'appointments': {
      const type = get('type');
      if (type) out.push(typeFacetParam(def, type, 'type'));
      const department = get('department');
      if (department) out.push(linkIs('belongsToDepartment', department));
      const patient = get('patient');
      if (patient) out.push(linkIs('appointmentOf', patient));
      const doctor = get('doctor');
      if (doctor) out.push(linkThrough('appointmentOf', '?__p', 'treatedBy', doctor));
      const hospital = get('hospital');
      if (hospital) out.push(linkThrough('belongsToDepartment', '?__d', 'locatedIn', hospital));
      out.push(...dateFilters(get('dateFrom'), get('dateTo'), '?__date'));
      if (truthy(get('upcoming')))
        out.push(`FILTER(BOUND(?__date) && ?__date >= "${todayStamp()}")`);
      break;
    }
    case 'departments': {
      const type = get('type');
      if (type) out.push(typeFacetParam(def, type, 'type'));
      const hospital = get('hospital');
      if (hospital) out.push(linkIs('locatedIn', hospital));
      const doctor = get('doctor');
      if (doctor) out.push(linkIs('hasDoctor', doctor));
      break;
    }
    case 'hospitals': {
      const type = get('type');
      if (type) out.push(typeFacetParam(def, type, 'type'));
      const department = get('department');
      if (department) out.push(linkIs('hasDepartment', department));
      break;
    }
  }

  return out.filter(Boolean);
}

const AGE_ALIASES: Record<string, string> = {
  child: 'ChildPatient',
  children: 'ChildPatient',
  adult: 'AdultPatient',
  elderly: 'ElderlyPatient',
  senior: 'ElderlyPatient',
  chronic: 'ChronicPatient',
  emergency: 'EmergencyPatient',
  ChildPatient: 'ChildPatient',
  AdultPatient: 'AdultPatient',
  ElderlyPatient: 'ElderlyPatient',
  ChronicPatient: 'ChronicPatient',
  EmergencyPatient: 'EmergencyPatient',
};

const asInt = (raw: string, param: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw badRequest(`Invalid integer for ${param}: ${raw}`);
  return n;
};

const todayStamp = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, '');

/** Role based data scoping, expressed inside the SPARQL WHERE body. */
export type ScopeKind = 'none' | 'ownPatient' | 'treatingDoctor';

export function buildScope(def: EntityDef, kind: ScopeKind, individualId: string): string {
  if (kind === 'none') return '';
  const id = idValue(individualId, 'scope');
  if (def.key === 'patients') {
    return kind === 'ownPatient'
      ? `FILTER(?s = ${iriToken(id)})`
      : exists(`?s ${iriToken('treatedBy')} ${iriToken(id)}`);
  }
  const linkPredicate = def.key === 'tests' ? 'isTestOf' : 'appointmentOf';
  if (def.key !== 'tests' && def.key !== 'appointments') return '';
  return kind === 'ownPatient'
    ? exists(`?s ${iriToken(linkPredicate)} ${iriToken(id)}`)
    : exists(
        `?s ${iriToken(linkPredicate)} ?__sp . ?__sp ${iriToken('treatedBy')} ${iriToken(id)}`,
      );
}
