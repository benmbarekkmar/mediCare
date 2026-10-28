import { beforeAll, describe, expect, it } from 'vitest';
import { asSession, login, resetSqlite, type Session } from '../setup/api';
import { loadFixture } from '../setup/store';
import { entityDef } from '../../src/ontology/registry';
import { entityRepo } from '../../src/repos/entity.repo';
import { sparql } from '../../src/sparql/client';
import { prefixes } from '../../src/sparql/prefixes';
import { consistencyService } from '../../src/services/consistency.service';

let admin: Session;
let reception: Session;

beforeAll(async () => {
  resetSqlite();
  await loadFixture();
  admin = await login('ADMIN');
  reception = await login('RECEPTIONIST');
}, 180000);

/** The app declares named prefixes only; the specs write `:Patient_Ahmed` like the Turtle file. */
const declare = (body: string): string => `PREFIX : <${prefixes.get('ont')}>\n${prefixes.withPrefixes(body)}`;

/** Runs an ASK against the test store so the graph itself is verified, not just the API echo. */
const ask = (query: string): Promise<boolean> => sparql.ask(declare(query));
const count = async (query: string): Promise<number> =>
  Number((await sparql.select(declare(`SELECT (COUNT(*) AS ?c) WHERE { ${query} }`))).rows[0]?.['c']?.value ?? 0);

const hasType = (id: string, cls: string): Promise<boolean> =>
  ask(`ASK WHERE { :${id} rdf:type :${cls} }`);

describe('identifier generation', () => {
  it('slugifies a name for people and institutions', async () => {
    const res = await asSession(reception)
      .post('/api/patients')
      .send({ name: '  Yasmine   Ben Salah ', age: 29, relations: { doctors: ['Doctor_Salma'], diseases: ['Asthma'] } })
      .expect(201);
    expect(res.body.id).toBe('Patient_YasmineBenSalah');
    // the identifier is slugified, the human label keeps the name as typed
    expect(res.body.label).toBe('Yasmine   Ben Salah');
  });

  it('appends a counter when the slug already exists', async () => {
    const second = await asSession(reception)
      .post('/api/patients')
      .send({ name: 'Yasmine Ben Salah', age: 31, relations: { doctors: ['Doctor_Salma'], diseases: ['Asthma'] } })
      .expect(201);
    expect(second.body.id).toBe('Patient_YasmineBenSalah_2');
  });

  it('numbers sequential entities from the chosen type', async () => {
    const created = await asSession(admin)
      .post('/api/tests')
      .send({ types: ['BloodTest'], date: '2026-08-02T08:30:00', result: 'Platelets 240 G/L', relations: { patient: ['Patient_Ahmed'] } })
      .expect(201);
    expect(created.body.id).toMatch(/^BloodTest_\d{3}$/);
    expect(created.body.id).not.toBe('BloodTest_001');
  });

  it('refuses a sequential entity without the type that names it', async () => {
    const res = await asSession(admin)
      .post('/api/tests')
      .send({ date: '2026-08-02T08:30:00', result: 'x', relations: { patient: ['Patient_Ahmed'] } });
    expect(res.status).toBe(422);
    expect((res.body.details.violations as string[]).join(' ')).toMatch(/Test type is mandatory/);
  });
});

describe('materialization on create', () => {
  let patientId = '';

  beforeAll(async () => {
    const res = await asSession(reception)
      .post('/api/patients')
      .send({
        name: 'Slimen Gharbi',
        age: 72,
        gender: 'Male',
        relations: { doctors: ['Doctor_Salma'], diseases: ['Diabetes'] },
      })
      .expect(201);
    patientId = res.body.id as string;
  });

  it('asserts the chosen class, its superclasses and owl:NamedIndividual', async () => {
    expect(await hasType(patientId, 'ElderlyPatient')).toBe(true);
    expect(await hasType(patientId, 'Patient')).toBe(true);
    expect(await ask(`ASK WHERE { :${patientId} a owl:NamedIndividual }`)).toBe(true);
  });

  it('never asserts a contradicting sibling class', async () => {
    expect(await hasType(patientId, 'AdultPatient')).toBe(false);
    expect(await hasType(patientId, 'ChildPatient')).toBe(false);
  });

  it('adds rdfs:label and the searchable name', async () => {
    const item = await entityRepo.getById(entityDef('patients'), patientId);
    expect(item?.label).toBe('Slimen Gharbi');
    expect(item?.fields.age).toBe(72);
    expect(item?.fields.gender).toBe('Male');
  });

  it('writes both directions of every inverse pair', async () => {
    expect(await ask(`ASK WHERE { :${patientId} :treatedBy :Doctor_Salma }`)).toBe(true);
    expect(await ask(`ASK WHERE { :Doctor_Salma :treats :${patientId} }`)).toBe(true);
    expect(await ask(`ASK WHERE { :${patientId} :hasDisease :Diabetes }`)).toBe(true);
    expect(await ask(`ASK WHERE { :Diabetes :isDiseaseOf :${patientId} }`)).toBe(true);
  });

  it('derives :ChronicPatient from the chronic disease axiom', async () => {
    expect(await hasType(patientId, 'ChronicPatient')).toBe(true);
    expect(await hasType(patientId, 'EmergencyPatient')).toBe(false);
  });

  it('materializes the property chains followedInDepartment and followedInHospital', async () => {
    expect(await ask(`ASK WHERE { :${patientId} :followedInDepartment :GeneralMedicineDepartment_01 }`)).toBe(true);
    expect(await ask(`ASK WHERE { :${patientId} :followedInHospital :Hospital_CharlesNicolle }`)).toBe(true);
  });

  it('leaves the graph closed under every axiom', async () => {
    const report = await consistencyService.audit();
    expect(report.checks.map((c) => [c.id, c.count]).filter(([, n]) => Number(n) > 0)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('materialization on update', () => {
  let id = '';

  beforeAll(async () => {
    const res = await asSession(reception)
      .post('/api/patients')
      .send({ name: 'Halim Mejri', age: 40, relations: { doctors: ['Doctor_Salma'], diseases: ['Diabetes'] } })
      .expect(201);
    id = res.body.id as string;
  });

  it('moves the patient into the right age class when the age changes', async () => {
    expect(await hasType(id, 'AdultPatient')).toBe(true);
    const res = await asSession(reception).patch(`/api/patients/${id}`).send({ age: 70 }).expect(200);
    expect(res.body.fields.age).toBe(70);
    expect(await hasType(id, 'ElderlyPatient')).toBe(true);
    expect(await hasType(id, 'AdultPatient')).toBe(false);
  });

  it('drops :ChronicPatient when the last chronic disease is removed', async () => {
    expect(await hasType(id, 'ChronicPatient')).toBe(true);
    await asSession(reception).patch(`/api/patients/${id}`).send({ relations: { diseases: ['Influenza'] } }).expect(200);
    expect(await hasType(id, 'ChronicPatient')).toBe(false);
    expect(await ask(`ASK WHERE { :Diabetes :isDiseaseOf :${id} }`)).toBe(false);
    expect(await ask(`ASK WHERE { :Influenza :isDiseaseOf :${id} }`)).toBe(true);
  });

  it('follows the doctor when they move to another department', async () => {
    const department = await entityRepo.getById(entityDef('doctors'), 'Doctor_Salma');
    expect(department?.relations.department).toMatchObject({ id: 'GeneralMedicineDepartment_01' });

    // a cardiologist must sit in a cardiology department, so use an axiom legal move
    await asSession(admin)
      .patch('/api/doctors/Doctor_Mohamed')
      .send({ relations: { department: ['CardiologyDepartment_02'] } })
      .expect(200);
    expect(await ask(`ASK WHERE { :Patient_Karim :followedInDepartment :CardiologyDepartment_02 }`)).toBe(true);
    expect(await ask(`ASK WHERE { :Patient_Karim :followedInDepartment :CardiologyDepartment_01 }`)).toBe(false);
  });

  it('refreshes the derived label when the name changes', async () => {
    const res = await asSession(reception).patch(`/api/patients/${id}`).send({ name: 'Halim B. Mejri' }).expect(200);
    expect(res.body.label).toBe('Halim B. Mejri');
    expect(await ask(`ASK WHERE { :${id} rdfs:label "Halim B. Mejri" }`)).toBe(true);
    expect(await count(`:${id} rdfs:label "Halim Mejri"`)).toBe(0);
  });

  it('keeps functional data properties single valued', async () => {
    await asSession(reception).patch(`/api/patients/${id}`).send({ phone: '55112233' }).expect(200);
    await asSession(reception).patch(`/api/patients/${id}`).send({ phone: '77998877' }).expect(200);
    expect(await count(`:${id} :hasPhoneNumber ?v`)).toBe(1);
  });

  it('stores synonyms as skos:altLabel and replaces them wholesale', async () => {
    await asSession(admin)
      .patch(`/api/patients/${id}`)
      .send({ altLabels: ['halfa', 'el halim'] })
      .expect(200);
    expect(await count(`:${id} skos:altLabel ?v`)).toBe(2);
    await asSession(admin).patch(`/api/patients/${id}`).send({ altLabels: ['halouma'] }).expect(200);
    expect(await count(`:${id} skos:altLabel ?v`)).toBe(1);
    expect(await ask(`ASK WHERE { :${id} skos:altLabel "halouma"@en }`)).toBe(true);
  });

  it('recomputes :EmergencyPatient when an emergency appointment appears', async () => {
    expect(await hasType('Patient_Sara', 'EmergencyPatient')).toBe(false);
    await asSession(reception)
      .post('/api/appointments')
      .send({
        types: ['EmergencyAppointment'],
        date: '2026-11-04T02:00:00',
        status: 'Confirmed',
        relations: { patient: ['Patient_Sara'], department: ['EmergencyDepartment_01'] },
      })
      .expect(201);
    expect(await hasType('Patient_Sara', 'EmergencyPatient')).toBe(true);
  });

  it('leaves the graph consistent after a whole editing session', async () => {
    const report = await consistencyService.audit();
    expect(report.violations).toBe(0);
  });
});

describe('axiom enforcement returns 422', () => {
  const cases: { title: string; entity: string; body: Record<string, unknown>; expect: RegExp }[] = [
    {
      title: 'a cardiologist cannot work in the emergency department',
      entity: 'doctors',
      body: {
        name: 'Bad Placement',
        licenseNumber: 'CARD-90001',
        types: ['Cardiologist'],
        relations: { department: ['EmergencyDepartment_01'] },
      },
      expect: /must work in a CardiologyDepartment/,
    },
    {
      title: 'a disease needs at least one symptom',
      entity: 'diseases',
      body: { name: 'Silent Disease', relations: { treatments: ['DiabetesTreatment'] } },
      expect: /at least one symptom/i,
    },
    {
      title: 'a disease needs at least one treatment',
      entity: 'diseases',
      body: { name: 'Untreatable Disease', relations: { symptoms: ['Fever_01'] } },
      expect: /at least one treatment/i,
    },
    {
      title: 'a medication treatment must use a medication',
      entity: 'treatments',
      body: { name: 'Empty Protocol', types: ['MedicationTreatment'] },
      expect: /must use at least one medication/i,
    },
    {
      title: 'an emergency appointment belongs to an emergency department',
      entity: 'appointments',
      body: {
        types: ['EmergencyAppointment'],
        date: '2026-12-01T10:00:00',
        status: 'Pending',
        relations: { patient: ['Patient_Ahmed'], department: ['CardiologyDepartment_01'] },
      },
      expect: /EmergencyDepartment/,
    },
    {
      title: 'a department must sit in a hospital',
      entity: 'departments',
      body: { name: 'Orphan Unit', types: ['NeurologyDepartment'] },
      expect: /locatedIn/,
    },
    {
      title: 'an unknown class is rejected',
      entity: 'tests',
      body: { types: ['TarotReading'], date: '2026-12-01T10:00:00', result: 'x', relations: { patient: ['Patient_Ahmed'] } },
      expect: /Unknown Test type/,
    },
    {
      title: 'an age outside the declared range is rejected',
      entity: 'patients',
      body: { name: 'Impossible Person', age: 250, relations: { doctors: ['Doctor_Salma'], diseases: ['Diabetes'] } },
      expect: /age must be <= 120/,
    },
  ];

  for (const testCase of cases) {
    it(testCase.title, async () => {
      const res = await asSession(admin).post(`/api/${testCase.entity}`).send(testCase.body);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.code).toBe('AXIOM_VIOLATION');
      expect((res.body.details.violations as string[]).join('\n')).toMatch(testCase.expect);
    });
  }

  it('rejects a link to an individual that does not exist', async () => {
    const res = await asSession(admin).post('/api/patients').send({
      name: 'Ghost Follower',
      age: 30,
      relations: { doctors: ['Doctor_Nobody'], diseases: ['Diabetes'] },
    });
    expect(res.status).toBe(422);
    expect((res.body.details.violations as string[]).join(' ')).toMatch(/Unknown doctors: Doctor_Nobody/);
  });

  it('rejects two doctors sharing a licence number with 409', async () => {
    const res = await asSession(admin).post('/api/doctors').send({
      name: 'Copycat Doctor',
      licenseNumber: 'MED-36214',
      types: ['GeneralPractitioner'],
      relations: { department: ['GeneralMedicineDepartment_01'] },
    });
    expect(res.status).toBe(409);
    expect(res.body.details.duplicates[0].id).toBe('Doctor_Salma');
  });

  it('rejects a computed relation written by hand', async () => {
    const res = await asSession(admin).post('/api/patients').send({
      name: 'Chain Hacker',
      age: 20,
      relations: {
        doctors: ['Doctor_Salma'],
        diseases: ['Diabetes'],
        department: ['CardiologyDepartment_01'],
      },
    });
    expect(res.status).toBe(400);
    expect((res.body.details.violations as string[]).join(' ')).toMatch(/computed by the ontology/);
  });

  it('rejects an unknown field with the allowed list', async () => {
    const res = await asSession(admin).post('/api/patients').send({ name: 'X', age: 3, nickname: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.details.allowed).toContain('age');
  });
});

describe('deletion rules', () => {
  it('cascades a patient delete onto their appointments and tests', async () => {
    const patient = await asSession(reception)
      .post('/api/patients')
      .send({ name: 'Karim Zouari', age: 33, relations: { doctors: ['Doctor_Salma'], diseases: ['Asthma'] } })
      .expect(201);
    const id = patient.body.id as string;
    const appointment = await asSession(reception)
      .post('/api/appointments')
      .send({
        types: ['Consultation'],
        date: '2027-02-02T09:00:00',
        status: 'Pending',
        relations: { patient: [id], department: ['GeneralMedicineDepartment_01'] },
      })
      .expect(201);
    const test = await asSession(admin)
      .post('/api/tests')
      .send({
        types: ['XRay'],
        date: '2027-02-01T09:00:00',
        result: 'No fracture',
        relations: { patient: [id] },
      })
      .expect(201);

    const res = await asSession(admin).delete(`/api/patients/${id}`).expect(200);
    expect(res.body.deleted).toContain(id);
    expect(res.body.deleted).toContain(appointment.body.id);
    expect(res.body.deleted).toContain(test.body.id);
    expect(await ask(`ASK WHERE { :${id} ?p ?o }`)).toBe(false);
    expect(await ask(`ASK WHERE { ?s ?p :${id} }`)).toBe(false);
    expect(await ask(`ASK WHERE { :${appointment.body.id} ?p ?o }`)).toBe(false);
    expect(await ask(`ASK WHERE { :${test.body.id} ?p ?o }`)).toBe(false);
    expect(await consistencyService.audit()).toMatchObject({ ok: true });
  });

  it('blocks the delete of master data with 409 and lists the dependents', async () => {
    const res = await asSession(admin).delete('/api/doctors/Doctor_Salma');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    const reports = res.body.details.dependents as { entity: string; count: number; items: { id: string }[] }[];
    expect(reports.length).toBeGreaterThan(0);
    const patients = reports.find((r) => r.entity === 'patients');
    const listed = patients?.items.map((i) => i.id) ?? [];
    // specs earlier created extra patients under the same doctor, so check the seeded ones
    for (const id of ['Patient_Ahmed', 'Patient_Sara', 'Patient_Youssef']) expect(listed).toContain(id);
    expect(patients?.count).toBe(listed.length);
    expect(await ask(`ASK WHERE { :Doctor_Salma ?p ?o }`)).toBe(true);
  });

  it('reassigns the dependents when reassignTo is given', async () => {
    // Doctor_Salma is a general practitioner, so the target must be one too
    const target = await asSession(admin)
      .post('/api/doctors')
      .send({
        name: 'Amel Gharbi',
        licenseNumber: 'GEN-77812',
        types: ['GeneralPractitioner'],
        relations: { department: ['GeneralMedicineDepartment_02'] },
      })
      .expect(201);

    const res = await asSession(admin)
      .delete('/api/doctors/Doctor_Salma')
      .send({ reassignTo: target.body.id })
      .expect(200);
    expect(res.body.reassigned).toBe(target.body.id);
    expect(await ask(`ASK WHERE { :Doctor_Salma ?p ?o }`)).toBe(false);
    expect(await ask(`ASK WHERE { :Patient_Ahmed :treatedBy :${target.body.id} }`)).toBe(true);
    expect(await ask(`ASK WHERE { :${target.body.id} :treats :Patient_Ahmed }`)).toBe(true);
    expect(await hasType('Patient_Ahmed', 'ChronicPatient')).toBe(true);
    expect(
      await ask(`ASK WHERE { :Patient_Ahmed :followedInDepartment :GeneralMedicineDepartment_02 }`),
    ).toBe(true);
    const report = await consistencyService.audit();
    expect(report.violations).toBe(0);
  });

  it('refuses a reassignment target that does not exist', async () => {
    const res = await asSession(admin).delete('/api/diseases/Asthma').send({ reassignTo: 'Disease_Missing' });
    expect(res.status).toBe(404);
  });

  it('refuses reassignTo on an individual nobody depends on', async () => {
    const created = await asSession(admin)
      .post('/api/diseases')
      .send({ name: 'Lonely Disease', types: ['InfectiousDisease'], relations: { symptoms: ['Fever_01'], treatments: ['DiabetesTreatment'] } })
      .expect(201);
    const res = await asSession(admin)
      .delete(`/api/diseases/${created.body.id}`)
      .send({ reassignTo: 'Influenza' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no dependents/);
  });

  it('reports the dependents before the operator confirms', async () => {
    const res = await asSession(admin).get('/api/hospitals/Hospital_CharlesNicolle/dependents').expect(200);
    expect(res.body.dependents.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).toContain('departments');
  });

  it('lets a hospital go once its departments moved away', async () => {
    const departments = await asSession(admin).get('/api/departments?hospital=Hospital_Rabta&pageSize=100').expect(200);
    for (const department of departments.body.items as { id: string }[])
      await asSession(admin)
        .patch(`/api/departments/${department.id}`)
        .send({ relations: { hospital: ['Hospital_CliniqueAlAmal'] } })
        .expect(200);
    const res = await asSession(admin).delete('/api/hospitals/Hospital_Rabta').expect(200);
    expect(res.body.deleted).toEqual(['Hospital_Rabta']);
    expect(await ask(`ASK WHERE { :Hospital_Rabta ?p ?o }`)).toBe(false);
    expect((await consistencyService.audit()).violations).toBe(0);
  });
});

