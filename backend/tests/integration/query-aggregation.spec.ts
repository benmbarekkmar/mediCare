import { beforeAll, describe, expect, it } from 'vitest';
import { api, asSession, login, resetSqlite, type Session } from '../setup/api';
import { loadFixture } from '../setup/store';
import type { DashboardPayload } from '../../src/services/dashboard.service';

let admin: Session;
let reception: Session;
let doctor: Session;
let patient: Session;

beforeAll(async () => {
  resetSqlite();
  await loadFixture();
  admin = await login('ADMIN');
  reception = await login('RECEPTIONIST');
  doctor = await login('DOCTOR');
  patient = await login('PATIENT');
}, 180000);

interface Ref {
  id: string;
  label: string;
}

interface Row {
  id: string;
  label: string;
  types: string[];
  fields: Record<string, unknown>;
  relations: Record<string, Ref[] | Ref | null>;
}

interface Page {
  items: Row[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: string | null;
  order: string;
  q: string | null;
}

type Dashboard = DashboardPayload;
const list = (path: string, session = admin) => asSession(session).get(path).expect(200) as Promise<{ body: Page }>;

/** Relation lists come back as refs; this narrows the one cardinality the specs use. */
const refIds = (value: Ref[] | Ref | null | undefined): string[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value.map((r) => r.id) : [value.id];

describe('list queries: search, filters, sort, pagination', () => {
  it('returns the documented pagination envelope', async () => {
    const res = await list('/api/patients?page=1&pageSize=3');
    expect(res.body.items).toHaveLength(3);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(3);
    expect(res.body.total).toBe(10);
    expect(res.body.totalPages).toBe(4);
    expect(res.body).not.toHaveProperty('password');
  });

  it('walks the pages without repeating or dropping an individual', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await list(`/api/patients?pageSize=4&page=${page}&sort=label`);
      expect(res.body.items).toHaveLength(page === 3 ? 2 : 4);
      seen.push(...res.body.items.map((i) => i.id));
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(10);
  });

  it('sorts ascending and descending on a sortable data property', async () => {
    const asc = await list('/api/patients?pageSize=100&sort=age&order=asc');
    const ages = asc.body.items.map((i) => Number(i.fields.age));
    expect([...ages].sort((a, b) => a - b)).toEqual(ages);
    expect(ages[0]).toBe(8);

    const desc = await list('/api/patients?pageSize=100&sort=age&order=desc');
    expect(desc.body.items[0]?.fields.age).toBe(74);
  });

  it('refuses a non sortable field and a broken page number', async () => {
    expect((await asSession(admin).get('/api/patients?sort=bloodType')).status).toBe(400);
    expect((await asSession(admin).get('/api/patients?page=0')).status).toBe(400);
    expect((await asSession(admin).get('/api/patients?order=sideways')).status).toBe(400);
    // pageSize is capped rather than refused
    const capped = await asSession(admin).get('/api/patients?pageSize=5000').expect(200);
    expect(capped.body.pageSize).toBe(100);
  });

  it('searches case insensitively over labels and searchable properties', async () => {
    const byName = await list('/api/patients?q=ben ali');
    expect(byName.body.items.map((i) => i.id).sort()).toEqual(['Patient_Ahmed']);
    expect(byName.body.q).toBe('ben ali');

    const byLicense = await list('/api/doctors?q=MED-51');
    expect(byLicense.body.items.map((i) => i.id)).toEqual(['Doctor_Hatem']);

    const nothing = await list('/api/patients?q=zzzz-no-such-person');
    expect(nothing.body.items).toEqual([]);
    expect(nothing.body.total).toBe(0);
  });

  it('applies the entity specific filters', async () => {
    const children = await list('/api/patients?ageGroup=child');
    expect(children.body.items.map((i) => i.id).sort()).toEqual(['Patient_Omar', 'Patient_Youssef']);
    const elderly = await list('/api/patients?ageGroup=elderly');
    expect(elderly.body.items.map((i) => i.id).sort()).toEqual(['Patient_Fatma', 'Patient_Mariam']);

    const chronic = await list('/api/patients?chronic=true&pageSize=100');
    expect(chronic.body.total).toBeGreaterThan(0);
    for (const item of chronic.body.items) expect(item.types).toContain('ChronicPatient');

    const diabetics = await list('/api/patients?disease=Diabetes&pageSize=100');
    expect(diabetics.body.total).toBeGreaterThan(0);
    for (const item of diabetics.body.items) expect(refIds(item.relations.diseases)).toContain('Diabetes');

    const hypertensive = await list('/api/patients?disease=Hypertension&pageSize=100');
    expect(hypertensive.body.total).toBeGreaterThan(0);
    for (const item of hypertensive.body.items) expect(refIds(item.relations.diseases)).toContain('Hypertension');

    const adults = await list('/api/patients?minAge=30&maxAge=50&pageSize=100');
    for (const item of adults.body.items) {
      const age = Number(item.fields.age);
      expect(age).toBeGreaterThanOrEqual(30);
      expect(age).toBeLessThanOrEqual(50);
    }

    const men = await list('/api/patients?gender=Male&pageSize=100');
    for (const item of men.body.items) expect(item.fields.gender).toBe('Male');

    const cardiologists = await list('/api/doctors?specialty=Cardiologist&pageSize=100');
    expect(cardiologists.body.total).toBeGreaterThan(0);
    for (const item of cardiologists.body.items) expect(item.types).toContain('Cardiologist');

    const inRabta = await list('/api/doctors?hospital=Hospital_Rabta&pageSize=100');
    expect(inRabta.body.total).toBeGreaterThan(0);

    const infectious = await list('/api/diseases?category=InfectiousDisease&pageSize=100');
    expect(infectious.body.total).toBeGreaterThan(0);
    for (const item of infectious.body.items) expect(item.types).toContain('InfectiousDisease');

    const invalid = await asSession(admin).get('/api/patients?ageGroup=middleaged');
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('BAD_REQUEST');
  });

  it('filters appointments on status, department and a date range', async () => {
    const pending = await list('/api/appointments?status=Pending&pageSize=100');
    expect(pending.body.total).toBeGreaterThan(0);
    for (const item of pending.body.items) expect(item.fields.status).toBe('Pending');

    const inDepartment = await list('/api/appointments?department=GeneralMedicineDepartment_01&pageSize=100');
    expect(inDepartment.body.total).toBeGreaterThan(0);

    const inNovember = await list('/api/appointments?dateFrom=2026-11-01&dateTo=2026-11-30&pageSize=100');
    expect(inNovember.body.total).toBe(4);
    for (const item of inNovember.body.items)
      expect(String(item.fields.date).startsWith('2026-11')).toBe(true);

    // the fixture dates are in the past relative to the demo timeline
    const upcoming = await list('/api/appointments?upcoming=true&pageSize=100');
    expect(upcoming.body.total).toBeGreaterThanOrEqual(0);
    for (const item of upcoming.body.items)
      expect(Date.parse(String(item.fields.date))).toBeGreaterThanOrEqual(Date.now() - 86400000);

    expect((await asSession(admin).get('/api/appointments?dateFrom=not-a-date')).status).toBe(400);
  });

  it('filters tests by type, patient and date range', async () => {
    const blood = await list('/api/tests?type=BloodTest&pageSize=100');
    expect(blood.body.total).toBeGreaterThan(0);
    for (const item of blood.body.items) expect(item.types).toContain('BloodTest');

    const forAhmed = await list('/api/tests?patient=Patient_Ahmed&pageSize=100');
    expect(forAhmed.body.total).toBeGreaterThan(0);

    const since2026 = await list('/api/tests?dateFrom=2026-01-01&pageSize=100');
    expect(since2026.body.total).toBeGreaterThan(0);
  });

  it('keeps the query parameters out of the SPARQL text', async () => {
    // a quote or a brace must never break out of the pattern
    const hostile = await asSession(admin).get('/api/patients?q=%22%20%7D%20UNION%20%7B%20%3Fs%20%3Fp%20%3Fo').expect(200);
    expect(hostile.body.items).toEqual([]);
    const injection = await asSession(admin).get('/api/patients?disease=Diabetes%7D%20UNION%20%7B%3Fs%20a%20%3Fc');
    expect(injection.status).toBe(400);
    expect(injection.body.code).toBe('BAD_REQUEST');
  });

  it('serves the lightweight reference list used by the pickers', async () => {
    const res = await asSession(reception).get('/api/diseases/refs?limit=3').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).not.toHaveProperty('fields');

    const filtered = await asSession(reception).get('/api/diseases/refs?q=hypert').expect(200);
    expect((filtered.body as { id: string }[]).map((r) => r.id)).toContain('Hypertension');
  });
});

describe('global search', () => {
  it('groups hits per entity and matches the skos:altLabel synonyms', async () => {
    const res = await asSession(admin).get('/api/search?q=high blood pressure').expect(200);
    expect(res.body.term).toBe('high blood pressure');
    const diseases = res.body.groups.find((g: { entity: string }) => g.entity === 'diseases');
    expect(diseases.items.map((i: { id: string }) => i.id)).toContain('Hypertension');
    expect(diseases.total).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThan(0);
    expect(Array.isArray(res.body.queries)).toBe(true);
  });

  it('finds a disease by its synonym and a person by name', async () => {
    const flu = await asSession(admin).get('/api/search?q=lung infection&entities=diseases').expect(200);
    expect(flu.body.groups[0].items.map((i: { id: string }) => i.id)).toContain('Pneumonia');

    const people = await asSession(admin).get('/api/search?q=Salma&entities=doctors').expect(200);
    expect(people.body.groups[0].items.map((i: { id: string }) => i.id)).toContain('Doctor_Salma');
  });

  it('refuses an empty term and an unknown entity', async () => {
    expect((await asSession(admin).get('/api/search')).status).toBe(400);
    expect((await asSession(admin).get('/api/search?q=abc&entities=ghosts')).status).toBe(400);
  });

  it('applies the caller role to the result set', async () => {
    // a receptionist has no read permission on tests, so they never appear
    const asReception = await asSession(reception).get('/api/search?q=blood').expect(200);
    expect(asReception.body.groups.find((g: { entity: string }) => g.entity === 'tests')).toBeUndefined();

    const asPatient = await asSession(patient).get('/api/search?q=Ben&entities=patients').expect(200);
    const ids = asPatient.body.groups.flatMap((g: { items: { id: string }[] }) => g.items.map((i: { id: string }) => i.id));
    expect(ids).toEqual(['Patient_Ahmed']);
  });
});

describe('dashboard aggregates', () => {
  it('computes every KPI with SPARQL and ships the queries', async () => {
    const res = await asSession(admin).get('/api/dashboard').expect(200);
    const body = res.body as Dashboard;

    expect(body.counts.patients).toBe(10);
    expect(body.counts.doctors).toBe(8);
    expect(body.totalTriples).toBeGreaterThan(1000);
    expect(body.patientsByAgeClass.map((a) => a.label).sort()).toEqual([
      'AdultPatient',
      'ChildPatient',
      'ElderlyPatient',
    ]);
    const ageTotal = body.patientsByAgeClass.reduce((acc, a) => acc + a.value, 0);
    expect(ageTotal).toBe(body.counts.patients);

    expect(body.chronicShare.chronic).toBeGreaterThan(0);
    expect(body.chronicShare.chronicPct).toBe(Math.round((body.chronicShare.chronic / body.chronicShare.total) * 100));

    const statuses = new Map(body.appointmentsByStatus.map((a) => [a.label, a.value]));
    expect(statuses.get('Pending')).toBe(3);
    expect(statuses.get('Confirmed')).toBe(5);
    expect(statuses.get('Completed')).toBe(2);

    expect(body.testsByType.length).toBeGreaterThan(0);
    expect(body.departmentsByHospital.length).toBe(4);
    expect(body.topSymptoms.length).toBeGreaterThan(0);
    expect(body.patientsPerDoctor[0]?.value).toBeGreaterThan(0);
    expect(body.topDiseases[0]?.value).toBeGreaterThan(0);
    expect(body.patientsPerHospital).toHaveLength(4);
    expect(body.appointmentsToday).toBeGreaterThanOrEqual(0);
    expect(body.appointmentsPerMonth.map((m) => m.month)).toContain('2026-11');
    expect(body.upcomingAppointments.length).toBeGreaterThan(0);

    expect(Object.keys(body.queries)).toContain('counts');
    expect(body.queries.counts).toMatch(/GROUP BY/);
    expect(body.executionMs.counts).toBeGreaterThanOrEqual(0);
  });

  it('is available to the back office and the doctors but not to a patient', async () => {
    expect((await asSession(reception).get('/api/dashboard')).status).toBe(200);
    expect((await asSession(doctor).get('/api/dashboard')).status).toBe(200);
    const res = await asSession(patient).get('/api/dashboard');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('consistency audit and repair', () => {
  it('reports the materialization state of the shipped ontology', async () => {
    const res = await asSession(admin).get('/api/consistency').expect(200);
    expect(res.body.checks.length).toBeGreaterThanOrEqual(14);
    expect(res.body.checks.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(['subclass-closure', 'inverse-forward', 'chain-department', 'chronic-missing']),
    );
    expect(res.body.violations).toBe(res.body.checks.reduce((a: number, c: { count: number }) => a + c.count, 0));
    expect(res.body.ok).toBe(res.body.violations === 0);
    for (const check of res.body.checks as { id: string; axiom: string; query: string; count: number }[]) {
      expect(check.axiom.length).toBeGreaterThan(0);
      expect(check.query).toMatch(/SELECT/);
      expect(check.count).toBeGreaterThanOrEqual(0);
    }
  });

  it('repairs a store whose derived triples were stripped', async () => {
    const pristine = await asSession(admin).get('/api/consistency').expect(200);
    expect(pristine.body.ok, JSON.stringify(pristine.body.checks.filter((c: { count: number }) => c.count > 0))).toBe(true);

    // only annotations the materializer can recompute from the asserted facts
    await asSession(admin)
      .post('/api/console/update')
      .send({
        update: `DELETE { ?p rdf:type ?derived } WHERE { ?p rdf:type ?derived . FILTER(?derived IN (ont:ChronicPatient, ont:EmergencyPatient, ont:AdultPatient, ont:ChildPatient, ont:ElderlyPatient)) }
;
DELETE { ?p ont:followedInDepartment ?dep } WHERE { ?p ont:followedInDepartment ?dep }
;
DELETE { ?a ont:appointmentOf ?p } WHERE { ?a ont:appointmentOf ?p }`,
        confirm: true,
      })
      .expect(200);

    const broken = await asSession(admin).get('/api/consistency').expect(200);
    expect(broken.body.ok).toBe(false);
    const counts = new Map<string, number>(
      broken.body.checks.map((c: { id: string; count: number }) => [c.id, c.count] as [string, number]),
    );
    expect(counts.get('chronic-missing')).toBeGreaterThan(0);
    expect(counts.get('age-class-missing')).toBeGreaterThan(0);
    expect(counts.get('chain-department')).toBeGreaterThan(0);
    expect((counts.get('inverse-forward') ?? 0) + (counts.get('inverse-backward') ?? 0)).toBeGreaterThan(0);

    const repaired = await asSession(admin).post('/api/consistency/repair').expect(200);
    expect(repaired.body.applied).toBe(broken.body.violations - repaired.body.report.violations);
    expect(repaired.body.report.ok, JSON.stringify(repaired.body.report.checks.filter((c: { count: number }) => c.count > 0))).toBe(
      true,
    );

    // the appointments are reachable again through both directions of the inverse pair
    const appointments = await list('/api/appointments?pageSize=100');
    for (const item of appointments.body.items)
      expect((item.relations.patient as Ref).id).toMatch(/^Patient_/);
    const chronic = await list('/api/patients?chronic=true&pageSize=100');
    expect(chronic.body.total).toBeGreaterThan(0);
  }, 180000);

  it('is ADMIN only', async () => {
    for (const session of [reception, doctor, patient]) {
      expect((await asSession(session).get('/api/consistency')).status).toBe(403);
      expect((await asSession(session).post('/api/consistency/repair')).status).toBe(403);
    }
  });

  it('records the repair in the audit trail', async () => {
    const res = await asSession(admin).get('/api/audit?action=CONSISTENCY_REPAIR').expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].entity).toBe('ontology');
  });
});

describe('ontology explorer', () => {
  it('counts classes, properties, individuals and axioms from the store', async () => {
    const res = await asSession(admin).get('/api/ontology/stats').expect(200);
    expect(res.body.classes).toBeGreaterThan(20);
    expect(res.body.objectProperties).toBeGreaterThan(10);
    expect(res.body.datatypeProperties).toBeGreaterThan(10);
    expect(res.body.namedIndividuals).toBeGreaterThan(50);
    expect(res.body.triples).toBe(res.body.tboxTriples + res.body.aboxTriples);
    expect(res.body.axioms.inverseOf).toBeGreaterThan(5);
    expect(res.body.axioms.propertyChain).toBe(2);
    expect(res.body.axioms.hasKey).toBeGreaterThan(0);
    expect(res.body.axioms.restrictions).toBeGreaterThan(0);
    expect(res.body.individualsByEntity.patients).toBe(10);
  });

  it('builds the subclass tree with instance counts', async () => {
    const res = await asSession(admin).get('/api/ontology/classes').expect(200);
    const patient = res.body.classes.find((c: { id: string }) => c.id === 'Patient');
    expect(patient.individuals).toBe(10);
    expect(patient.children.map((c: { id: string }) => c.id).sort()).toEqual(
      ['AdultPatient', 'ChildPatient', 'ChronicPatient', 'ElderlyPatient', 'EmergencyPatient'].sort(),
    );
    expect(res.body.static.length).toBeGreaterThan(0);
  });

  it('lists the individuals of a class, subclass included', async () => {
    const res = await asSession(admin).get('/api/ontology/individuals?class=Cardiologist').expect(200);
    expect(res.body.classLocal).toBe('Cardiologist');
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.items[0].types).toEqual(expect.arrayContaining(['Cardiologist', 'Doctor', 'NamedIndividual']));

    const unknown = await asSession(admin).get('/api/ontology/individuals?class=Ghost');
    expect(unknown.status).toBe(400);
    expect((await asSession(admin).get('/api/ontology/individuals')).status).toBe(400);
  });

  it('describes properties with domain, range, inverses and chains', async () => {
    const res = await asSession(doctor).get('/api/ontology/properties').expect(200);
    const treatedBy = res.body.find((p: { name: string }) => p.name === 'treatedBy');
    expect(treatedBy.kind).toBe('object');
    expect(treatedBy.domain).toContain('Patient');
    expect(treatedBy.range).toContain('Doctor');
    expect(treatedBy.inverse).toBe('treats');
    const followed = res.body.find((p: { name: string }) => p.name === 'followedInDepartment');
    expect(followed.chains.length).toBe(1);
    expect(followed.chains[0]).toEqual(expect.arrayContaining(['treatedBy', 'worksIn']));
    const blood = res.body.find((p: { name: string }) => p.name === 'hasBloodType');
    expect(blood.kind).toBe('datatype');
    expect(blood.characteristics).toContain('FunctionalProperty');
  });

  it('returns a graph payload with nodes and labelled edges', async () => {
    const wide = await asSession(admin).get('/api/ontology/graph?limit=40').expect(200);
    expect((wide.body.nodes as unknown[]).length).toBeGreaterThan(0);
    expect((wide.body.edges as unknown[]).length).toBeGreaterThan(0);
    for (const node of wide.body.nodes as { id: string; label: string; group: string }[]) {
      expect(node.id).toBeTruthy();
      expect(node.label).toBeTruthy();
    }

    const focused = await asSession(admin)
      .get('/api/ontology/graph?focus=Patient_Ahmed&depth=3')
      .expect(200);
    expect(focused.body.focus).toBe('Patient_Ahmed');
    const ids = (focused.body.nodes as { id: string }[]).map((n) => n.id);
    expect(ids).toContain('Doctor_Salma');
    expect(ids).toContain('Diabetes');
    expect(ids).toContain('GeneralMedicineDepartment_01');
    expect(ids).toContain('Hospital_CharlesNicolle');

    const deep = await asSession(admin).get('/api/ontology/graph?focus=Patient_Ahmed&depth=1').expect(200);
    expect((deep.body.nodes as unknown[]).length).toBeLessThanOrEqual((focused.body.nodes as unknown[]).length);
    expect((await asSession(admin).get('/api/ontology/graph?focus=Patient_Ahmed&depth=abc')).status).toBe(400);
    expect((await asSession(admin).get('/api/ontology/graph?focus=Nope_Nobody')).status).toBe(404);
  });

  it('dumps every asserted triple of one individual', async () => {
    const res = await asSession(admin).get('/api/ontology/individuals/Patient_Ahmed').expect(200);
    expect(res.body.iri).toMatch(/#Patient_Ahmed$/);
    const predicates = res.body.outgoing.map((t: { predicate: string }) => t.predicate);
    expect(predicates).toEqual(expect.arrayContaining(['rdf:type', ':hasName', ':hasAge', ':hasDisease']));
    const incoming = res.body.incoming.map(
      (t: { predicate: string; value: string }) => `${t.predicate}:${t.value}`,
    );
    expect(incoming).toEqual(expect.arrayContaining([':treats:Doctor_Salma']));

    expect((await asSession(admin).get('/api/ontology/individuals/Patient_Nobody')).status).toBe(404);
    // a URL encoded SPARQL fragment never reaches the query as a pattern
    expect((await asSession(admin).get('/api/ontology/individuals/%22%20UNION%20%7B')).status).toBe(404);
  });
});

describe('SPARQL console', () => {
  it('runs a SELECT and reports the shape of the answer', async () => {
    const res = await asSession(admin)
      .post('/api/console/query')
      .send({ query: 'SELECT ?name WHERE { ?p a ont:Patient ; ont:hasName ?name } ORDER BY ?name', limit: 3 })
      .expect(200);
    expect(res.body.form).toBe('select');
    expect(res.body.vars).toEqual(['name']);
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.count).toBe(3);
    expect(res.body.query).toMatch(/LIMIT 3/);
    expect(res.body.executionMs).toBeGreaterThanOrEqual(0);
  });

  it('answers ASK and CONSTRUCT forms', async () => {
    const ask = await asSession(admin)
      .post('/api/console/query')
      .send({ query: 'ASK WHERE { ?p a ont:Patient ; ont:hasAge ?a . FILTER(?a > 60) }' })
      .expect(200);
    expect(ask.body.form).toBe('ask');
    expect(ask.body.answer).toBe(true);

    const construct = await asSession(admin)
      .post('/api/console/query')
      .send({ query: 'CONSTRUCT { ?p <urn:age> ?a } WHERE { ?p a ont:Patient ; ont:hasAge ?a } LIMIT 2' })
      .expect(200);
    expect(construct.body.form).toBe('construct');
    expect(construct.body.ntriples).toMatch(/Patient_/);
  });

  it('adds the project prefixes and caps the LIMIT', async () => {
    const res = await asSession(admin)
      .post('/api/console/query')
      .send({ query: 'SELECT ?s WHERE { ?s a ont:Symptom }', limit: 20 })
      .expect(200);
    expect(res.body.query).toMatch(/PREFIX ont:/);
    expect(res.body.query).toMatch(/LIMIT 20$/);

    const over = await asSession(admin)
      .post('/api/console/query')
      .send({ query: 'SELECT ?s WHERE { ?s a ont:Symptom } LIMIT 99999', limit: 5 })
      .expect(200);
    expect(over.body.query).toMatch(/LIMIT 5/);

    const ownPrefixes = await asSession(admin)
      .post('/api/console/query')
      .send({ query: 'PREFIX ox: <http://example.org/>\nSELECT ?s WHERE { ?s a ox:Nothing }' })
      .expect(200);
    // the caller binding survives and the project ones are added once
    expect(ownPrefixes.body.query.match(/PREFIX ox:/g)).toHaveLength(1);
    expect(ownPrefixes.body.query).toMatch(/PREFIX ont:/);
  });

  it('refuses update forms, remote services and empty input', async () => {
    for (const query of [
      'INSERT DATA { <urn:a> <urn:b> <urn:c> }',
      'DELETE WHERE { ?s ?p ?o }',
      'CLEAR DEFAULT',
      'SELECT * WHERE { ?s ?p ?o } LIMIT 1 ; INSERT DATA { <urn:x> <urn:y> 1 }',
      'SELECT ?s WHERE { SERVICE <http://evil.example/sparql> { ?s ?p ?o } }',
      'ASK',
    ]) {
      const res = await asSession(admin).post('/api/console/query').send({ query });
      expect(res.status, query).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    }
    expect((await asSession(admin).post('/api/console/query').send({ query: '   ' })).status).toBe(400);
  });

  it('requires an explicit confirmation for updates and blocks destructive verbs', async () => {
    const unconfirmed = await asSession(admin)
      .post('/api/console/update')
      .send({ update: 'INSERT DATA { <urn:test> <urn:p> 1 }' });
    expect(unconfirmed.status).toBe(400);

    const written = await asSession(admin)
      .post('/api/console/update')
      .send({ update: 'INSERT DATA { <urn:test-note> <urn:p> "probe" }', confirm: true })
      .expect(200);
    expect(written.body.operations).toHaveLength(1);
    expect(written.body.triples).toBeGreaterThan(0);

    const cleaned = await asSession(admin)
      .post('/api/console/update')
      .send({ update: 'DELETE DATA { <urn:test-note> <urn:p> "probe" }', confirm: true })
      .expect(200);
    expect(cleaned.body.executionMs).toBeGreaterThanOrEqual(0);

    for (const update of ['CLEAR DEFAULT', 'DROP SILENT GRAPH <urn:g>', 'LOAD <file:/etc/passwd>', 'MOVE <urn:a> TO <urn:b>']) {
      const res = await asSession(admin).post('/api/console/update').send({ update, confirm: true });
      expect(res.status, update).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    }
  });

  it('is ADMIN only on both the console and the documented /api/sparql entry point', async () => {
    for (const session of [reception, doctor, patient]) {
      const read = await asSession(session).post('/api/console/query').send({ query: 'SELECT * WHERE { ?s ?p ?o }' });
      expect(read.status, session.role).toBe(403);
      const sparqlPost = await asSession(session).post('/api/sparql').send({ query: 'ASK WHERE { ?s ?p ?o }', type: 'ask' });
      expect(sparqlPost.status, session.role).toBe(403);
      expect(sparqlPost.body.code).toBe('FORBIDDEN');
    }
  });

  it('dispatches on the type in POST /api/sparql', async () => {
    const read = await asSession(admin)
      .post('/api/sparql')
      .send({ query: 'SELECT (COUNT(DISTINCT ?p) AS ?c) WHERE { ?p a ont:Patient }', type: 'SELECT' })
      .expect(200);
    expect(read.body.type).toBe('select');
    expect(Number(read.body.rows[0]['c'].value)).toBe(10);

    const write = await asSession(admin)
      .post('/api/sparql')
      .send({ query: 'INSERT DATA { <urn:sparql-probe> <urn:p> 1 }', type: 'insert' });
    expect(write.status).toBe(400);

    const confirmed = await asSession(admin)
      .post('/api/sparql')
      .send({ query: 'DELETE DATA { <urn:sparql-probe> <urn:p> 1 }', type: 'delete', confirm: true });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    expect((await asSession(admin).post('/api/sparql').send({ query: 'SELECT ?s WHERE { ?s ?p ?o }', type: 'ghost' })).status).toBe(
      400,
    );
  });

  it('logs both console forms in the audit trail', async () => {
    const queries = await asSession(admin).get('/api/audit?action=SPARQL_QUERY&limit=5').expect(200);
    expect(queries.body.items.length).toBeGreaterThan(0);
    const updates = await asSession(admin).get('/api/audit?action=SPARQL_UPDATE&limit=5').expect(200);
    expect(updates.body.items.length).toBeGreaterThan(0);
  });
});

describe('registry metadata and public catalogues', () => {
  it('describes every entity the caller may read', async () => {
    const asAdmin = await asSession(admin).get('/api/meta/entities').expect(200);
    expect(asAdmin.body).toHaveLength(10);
    const patients = asAdmin.body.find((e: { key: string }) => e.key === 'patients');
    expect(patients.data.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['name', 'age', 'gender', 'bloodType', 'phone']),
    );
    expect(patients.relations.find((r: { field: string }) => r.field === 'diseases').required).toBe(true);
    expect(patients.writableFields).toBe('all');

    const asDoctor = await asSession(doctor).get('/api/meta/entities').expect(200);
    // a doctor reads the whole knowledge base, the doctor directory included
    expect(asDoctor.body.map((e: { key: string }) => e.key)).toEqual(
      expect.arrayContaining(['doctors', 'hospitals', 'patients']),
    );
    expect(asDoctor.body).toHaveLength(10);
    const doctorPatients = asDoctor.body.find((e: { key: string }) => e.key === 'patients');
    expect(doctorPatients.writable).toEqual({ create: false, update: true, delete: false });
    expect(doctorPatients.writableFields).toEqual(['diseases']);

    const asReception = await asSession(reception).get('/api/meta/entities').expect(200);
    const receptionKeys = asReception.body.map((e: { key: string }) => e.key);
    expect(receptionKeys).toContain('appointments');
    expect(receptionKeys).not.toContain('tests');
    expect(receptionKeys).not.toContain('medications');
  });

  it('exposes the closed value sets and the class ancestry', async () => {
    const specialties = await asSession(doctor).get('/api/meta/specialties').expect(200);
    expect(specialties.body.specialties).toContain('Cardiologist');
    expect(specialties.body.diseaseCategories).toContain('ChronicDisease');

    const hierarchy = await asSession(doctor).get('/api/meta/hierarchy').expect(200);
    const chain = hierarchy.body.ancestry.find((a: { classLocal: string }) => a.classLocal === 'Cardiologist');
    expect(chain.chain).toEqual(expect.arrayContaining(['Doctor']));
  });

  it('probes the store and refuses to write through a public route', async () => {
    const health = await asSession(admin).get('/api/meta/health').expect(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.tripleStore.dataset).toBe('medicare_test');

    const anonymous = await api().get('/api/public/diseases?pageSize=5').expect(200);
    expect(anonymous.body.items.length).toBeGreaterThan(0);
    expect(anonymous.body.pageSize).toBe(5);
    expect(anonymous.body.items[0].relations).toBeDefined();

    const one = await api().get('/api/public/diseases/Diabetes').expect(200);
    expect(one.body.fields.name).toBe('Diabetes');
    expect((one.body.relations.symptoms as unknown[]).length).toBeGreaterThan(0);

    expect((await api().get('/api/public/patients')).status).toBe(400);
    expect((await api().get('/api/public/patients/Patient_Ahmed')).status).toBe(400);
    expect((await api().get('/api/public/diseases/Nope')).status).toBe(404);
    expect((await api().post('/api/public/diseases').send({ name: 'Hack' })).status).toBe(404);
  });

  it('serves the OpenAPI document and the rendered docs', async () => {
    const spec = await api().get('/api/openapi.json').expect(200);
    expect(spec.body.openapi).toBe('3.0.3');
    expect(spec.body.paths['/api/patients']).toBeDefined();
    expect(spec.body.paths['/api/sparql']).toBeDefined();
    expect(Object.keys(spec.body.components.schemas)).toContain('Problem');

    const docs = await api().get('/api/docs/').expect(200);
    expect(docs.text).toMatch(/swagger-ui/);
  });

  it('answers with the error envelope on an unknown route', async () => {
    const res = await asSession(admin).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.status).toBe(404);
  });
});
