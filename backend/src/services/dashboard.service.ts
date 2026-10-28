import type { ResultValue } from '../sparql/client';
import { sparql } from '../sparql/client';
import { prefixes } from '../sparql/prefixes';
import type { EntityKey } from '../ontology/registry';
import { ENTITY_KEYS } from '../ontology/registry';
import { localOf } from '../sparql/escape';

interface Aggregate {
  label: string;
  value: number;
}

export interface DashboardPayload {
  generatedAt: string;
  counts: Record<EntityKey, number>;
  totalTriples: number;
  patientsByAgeClass: Aggregate[];
  chronicShare: { chronic: number; emergency: number; total: number; chronicPct: number };
  diseasesByCategory: Aggregate[];
  appointmentsByStatus: Aggregate[];
  appointmentsByType: Aggregate[];
  doctorsBySpecialty: Aggregate[];
  testsByType: Aggregate[];
  departmentsByHospital: Aggregate[];
  topSymptoms: Aggregate[];
  patientsPerDoctor: Aggregate[];
  topDiseases: Aggregate[];
  patientsPerHospital: Aggregate[];
  appointmentsToday: number;
  appointmentsPerMonth: { month: string; count: number }[];
  upcomingAppointments: {
    id: string;
    label: string;
    date: string;
    status: string;
    patient: string;
    department: string;
  }[];
  queries: Record<string, string>;
  executionMs: Record<string, number>;
}

/** `ont:`/`rdfs:` style prefixes are declared by the registry, queries stay readable. */
const q = (body: string): string => prefixes.withPrefixes(body);

/**
 * Every figure on the dashboard comes from a SPARQL aggregate executed by Fuseki;
 * the queries travel with the payload so the UI can show them.
 */
export class DashboardService {
  private queries: Record<string, string> = {};
  private timings: Record<string, number> = {};

  private async run<T>(name: string, body: string, fn: (query: string) => Promise<T>): Promise<T> {
    const query = q(body);
    this.queries[name] = query;
    const started = Date.now();
    const value = await fn(query);
    this.timings[name] = Date.now() - started;
    return value;
  }

  async build(): Promise<DashboardPayload> {
    const counts = await this.run('counts', COUNTS_QUERY, async (query) => {
      const { rows } = await sparql.select(query);
      const out = Object.fromEntries(ENTITY_KEYS.map((k) => [k, 0])) as Record<EntityKey, number>;
      for (const row of rows) {
        const cls = localOf(row['cls']?.value ?? '');
        const key = CLASS_TO_ENTITY[cls];
        if (key) out[key] = Number(row['c']?.value ?? 0);
      }
      return out;
    });

    const totalTriples = await this.run('triples', TRIPLES_QUERY, async (query) =>
      Number((await sparql.select(query)).rows[0]?.['c']?.value ?? 0),
    );

    const patientsByAgeClass = await this.run(
      'ageClasses',
      AGE_CLASS_QUERY,
      (query) => this.groupedQuery(query),
    );

    const chronic = await this.run('chronic', CHRONIC_QUERY, (query) => this.groupedQuery(query));
    const patientsTotal = counts.patients;

    const [diseasesByCategory, appointmentsByStatus, appointmentsByType, doctorsBySpecialty, testsByType] =
      await Promise.all([
        this.run('diseaseCategories', DISEASE_CATEGORY_QUERY, (query) => this.groupedQuery(query)),
        this.run('appointmentStatus', APPOINTMENT_STATUS_QUERY, (query) => this.literalQuery(query)),
        this.run('appointmentTypes', APPOINTMENT_TYPE_QUERY, (query) => this.groupedQuery(query)),
        this.run('specialties', SPECIALTY_QUERY, (query) => this.groupedQuery(query)),
        this.run('testTypes', TEST_TYPE_QUERY, (query) => this.groupedQuery(query)),
      ]);

    const departmentsByHospital = await this.run(
      'departmentsPerHospital',
      DEPARTMENTS_PER_HOSPITAL_QUERY,
      (query) => this.namedQuery(query),
    );
    const topSymptoms = await this.run('topSymptoms', TOP_SYMPTOM_QUERY, (query) => this.namedQuery(query));
    const patientsPerDoctor = await this.run(
      'patientsPerDoctor',
      PATIENTS_PER_DOCTOR_QUERY,
      (query) => this.namedQuery(query),
    );
    const upcomingAppointments = await this.run(
      'upcoming',
      UPCOMING_QUERY,
      async (query) => (await sparql.select(query)).rows.map(mapAppointment),
    );
    const appointmentsPerMonth = await this.run(
      'perMonth',
      APPOINTMENTS_PER_MONTH_QUERY,
      async (query) =>
        (await sparql.select(query)).rows
          .map((row) => ({
            month: `${row['y']?.value ?? ''}-${String(row['m']?.value ?? '').padStart(2, '0')}`,
            count: Number(row['c']?.value ?? 0),
          }))
          .sort((a, b) => a.month.localeCompare(b.month)),
    );

    const topDiseases = await this.run('topDiseases', TOP_DISEASE_QUERY, (query) =>
      this.namedQuery(query),
    );
    const patientsPerHospital = await this.run(
      'patientsPerHospital',
      PATIENTS_PER_HOSPITAL_QUERY,
      (query) => this.namedQuery(query),
    );
    const appointmentsToday = await this.run('appointmentsToday', APPOINTMENTS_TODAY_QUERY, async (query) =>
      Number((await sparql.select(query)).rows[0]?.['c']?.value ?? 0),
    );

    return {
      generatedAt: new Date().toISOString(),
      counts,
      totalTriples,
      patientsByAgeClass,
      chronicShare: {
        chronic: chronic.find((c) => c.label === 'ChronicPatient')?.value ?? 0,
        emergency: chronic.find((c) => c.label === 'EmergencyPatient')?.value ?? 0,
        total: patientsTotal,
        chronicPct: patientsTotal ? Math.round(((chronic.find((c) => c.label === 'ChronicPatient')?.value ?? 0) / patientsTotal) * 100) : 0,
      },
      diseasesByCategory,
      appointmentsByStatus,
      appointmentsByType,
      doctorsBySpecialty,
      testsByType,
      departmentsByHospital,
      topSymptoms,
      patientsPerDoctor,
      topDiseases,
      patientsPerHospital,
      appointmentsToday,
      appointmentsPerMonth,
      upcomingAppointments,
      queries: this.queries,
      executionMs: this.timings,
    };
  }

  private groupedQuery = async (query: string): Promise<Aggregate[]> => {
    const { rows } = await sparql.select(query);
    return rows
      .map((row) => ({ label: localOf(row['k']?.value ?? '') || 'Unclassified', value: Number(row['c']?.value ?? 0) }))
      .filter((a) => a.value > 0);
  };

  private literalQuery = async (query: string): Promise<Aggregate[]> => {
    const { rows } = await sparql.select(query);
    return rows
      .map((row) => ({ label: row['k']?.value ?? 'Unknown', value: Number(row['c']?.value ?? 0) }))
      .filter((a) => a.value > 0);
  };

  private namedQuery = async (query: string): Promise<Aggregate[]> => {
    const { rows } = await sparql.select(query);
    return rows
      .map((row) => ({ label: row['name']?.value ?? localOf(row['k']?.value ?? ''), value: Number(row['c']?.value ?? 0) }))
      .filter((a) => a.value > 0);
  };
}

const CLASS_TO_ENTITY: Record<string, EntityKey> = {
  Patient: 'patients',
  Doctor: 'doctors',
  Disease: 'diseases',
  Symptom: 'symptoms',
  Treatment: 'treatments',
  Medication: 'medications',
  MedicalTest: 'tests',
  MedicalAppointment: 'appointments',
  Hospital: 'hospitals',
  MedicalDepartment: 'departments',
};

const COUNTS_QUERY = `SELECT ?cls (COUNT(DISTINCT ?s) AS ?c) WHERE {
  ?s rdf:type ?cls .
  FILTER(?cls IN (ont:Patient, ont:Doctor, ont:Disease, ont:Symptom, ont:Treatment,
                 ont:Medication, ont:MedicalTest, ont:MedicalAppointment, ont:Hospital, ont:MedicalDepartment))
}
GROUP BY ?cls
ORDER BY ?cls`;

const TRIPLES_QUERY = `SELECT (COUNT(*) AS ?c) WHERE { ?s ?p ?o }`;

const AGE_CLASS_QUERY = `SELECT ?k (COUNT(DISTINCT ?p) AS ?c) WHERE {
  VALUES ?k { ont:ChildPatient ont:AdultPatient ont:ElderlyPatient }
  ?p rdf:type ?k
}
GROUP BY ?k
ORDER BY ?k`;

const CHRONIC_QUERY = `SELECT ?k (COUNT(DISTINCT ?p) AS ?c) WHERE {
  VALUES ?k { ont:ChronicPatient ont:EmergencyPatient ont:Patient }
  ?p rdf:type ?k
}
GROUP BY ?k`;

const DISEASE_CATEGORY_QUERY = `SELECT ?k (COUNT(DISTINCT ?d) AS ?c) WHERE {
  VALUES ?k { ont:InfectiousDisease ont:ChronicDisease ont:CardiovascularDisease ont:RespiratoryDisease }
  ?d rdf:type ?k
}
GROUP BY ?k
ORDER BY DESC(?c)`;

const APPOINTMENT_STATUS_QUERY = `SELECT ?k (COUNT(DISTINCT ?a) AS ?c) WHERE {
  ?a a ont:MedicalAppointment ; ont:appointmentStatus ?k
}
GROUP BY ?k
ORDER BY DESC(?c)`;

const APPOINTMENT_TYPE_QUERY = `SELECT ?k (COUNT(DISTINCT ?a) AS ?c) WHERE {
  VALUES ?k { ont:Consultation ont:FollowUpAppointment ont:EmergencyAppointment }
  ?a rdf:type ?k
}
GROUP BY ?k`;

const SPECIALTY_QUERY = `SELECT ?k (COUNT(DISTINCT ?d) AS ?c) WHERE {
  VALUES ?k { ont:GeneralPractitioner ont:EmergencyPhysician ont:Cardiologist ont:Dermatologist ont:Neurologist }
  ?d rdf:type ?k
}
GROUP BY ?k
ORDER BY DESC(?c)`;

const TEST_TYPE_QUERY = `SELECT ?k (COUNT(DISTINCT ?t) AS ?c) WHERE {
  VALUES ?k { ont:BloodTest ont:UrineTest ont:XRay ont:MRI ont:CTScan }
  ?t rdf:type ?k
}
GROUP BY ?k
ORDER BY DESC(?c)`;

const DEPARTMENTS_PER_HOSPITAL_QUERY = `SELECT ?k ?name (COUNT(DISTINCT ?d) AS ?c) WHERE {
  ?h a ont:Hospital ; rdfs:label ?name .
  BIND(?h AS ?k)
  OPTIONAL { ?d ont:locatedIn ?h }
}
GROUP BY ?k ?name
ORDER BY DESC(?c)`;

const TOP_SYMPTOM_QUERY = `SELECT ?k ?name (COUNT(DISTINCT ?p) AS ?c) WHERE {
  ?p ont:hasDisease ?d .
  ?d ont:hasSymptom ?s .
  ?s rdfs:label ?name .
  BIND(?s AS ?k)
}
GROUP BY ?k ?name
ORDER BY DESC(?c)
LIMIT 8`;

const PATIENTS_PER_DOCTOR_QUERY = `SELECT ?k ?name (COUNT(DISTINCT ?p) AS ?c) WHERE {
  ?d a ont:Doctor ; rdfs:label ?name .
  BIND(?d AS ?k)
  OPTIONAL { ?p ont:treatedBy ?d }
}
GROUP BY ?k ?name
ORDER BY DESC(?c)
LIMIT 8`;

const TOP_DISEASE_QUERY = `SELECT ?k ?name (COUNT(DISTINCT ?p) AS ?c) WHERE {
  ?p ont:hasDisease ?d .
  ?d rdfs:label ?name .
  BIND(?d AS ?k)
}
GROUP BY ?k ?name
ORDER BY DESC(?c)
LIMIT 8`;

const PATIENTS_PER_HOSPITAL_QUERY = `SELECT ?k ?name (COUNT(DISTINCT ?p) AS ?c) WHERE {
  ?h a ont:Hospital ; rdfs:label ?name .
  BIND(?h AS ?k)
  OPTIONAL { ?p ont:treatedBy ?d . ?d ont:worksIn ?dep . ?dep ont:locatedIn ?h }
}
GROUP BY ?k ?name
ORDER BY DESC(?c)`;

const APPOINTMENTS_TODAY_QUERY = `SELECT (COUNT(DISTINCT ?a) AS ?c) WHERE {
  ?a a ont:MedicalAppointment ; ont:appointmentDate ?date .
  FILTER (YEAR(?date) = YEAR(now()) && MONTH(?date) = MONTH(now()) && DAY(?date) = DAY(now()))
}`;

const UPCOMING_QUERY = `SELECT ?a ?label ?date ?status ?patientName ?departmentName WHERE {
  ?a a ont:MedicalAppointment ;
     ont:appointmentDate ?date ;
     ont:appointmentStatus ?status ;
     ont:appointmentOf ?p ;
     ont:belongsToDepartment ?dep .
  ?p rdfs:label ?patientName .
  ?dep rdfs:label ?departmentName .
  OPTIONAL { ?a rdfs:label ?label }
  FILTER(?date >= now())
  FILTER(?status IN ("Pending", "Confirmed"))
}
ORDER BY ASC(?date)
LIMIT 10`;

/** BIND makes the derived year and month real group keys instead of bare SELECT expressions. */
const APPOINTMENTS_PER_MONTH_QUERY = `SELECT ?y ?m (COUNT(DISTINCT ?a) AS ?c) WHERE {
  ?a a ont:MedicalAppointment ; ont:appointmentDate ?date .
  BIND(YEAR(?date) AS ?y)
  BIND(MONTH(?date) AS ?m)
}
GROUP BY ?y ?m
ORDER BY ?y ?m`;

const mapAppointment = (row: Record<string, ResultValue>): DashboardPayload['upcomingAppointments'][number] => ({
  id: localOf(row['a']?.value ?? ''),
  label: row['label']?.value ?? localOf(row['a']?.value ?? ''),
  date: row['date']?.value ?? '',
  status: row['status']?.value ?? '',
  patient: row['patientName']?.value ?? '',
  department: row['departmentName']?.value ?? '',
});

export const dashboardService = new DashboardService();
