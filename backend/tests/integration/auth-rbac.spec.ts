import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asSession, bearer, login, resetSqlite, type Session } from '../setup/api';
import { loadFixture } from '../setup/store';
import { listAudit } from '../../src/auth/audit';
import { entityDef } from '../../src/ontology/registry';
import { entityRepo } from '../../src/repos/entity.repo';

let admin: Session;
let reception: Session;
let doctor: Session;
let otherDoctor: Session;
let patient: Session;
let otherPatient: Session;

beforeAll(async () => {
  resetSqlite();
  await loadFixture();
  admin = await login('ADMIN');
  reception = await login('RECEPTIONIST');
  doctor = await login('DOCTOR');
  otherDoctor = await login('DOCTOR', 'hatem.trabelsi@medicare.tn');
  patient = await login('PATIENT');
  otherPatient = await login('PATIENT', 'sara@medicare.tn');
}, 180000);

describe('authentication', () => {
  it('issues a token pair and the public profile on login', () => {
    expect(typeof admin.accessToken).toBe('string');
    expect(admin.accessToken.split('.')).toHaveLength(3);
    expect(admin.role).toBe('ADMIN');
    expect(admin.linkedId).toBeNull();
    expect(doctor.linkedId).toBe('Doctor_Salma');
    expect(patient.linkedId).toBe('Patient_Ahmed');
  });

  it('rejects a wrong password without leaking the account', async () => {
    const res = await api().post('/api/auth/login').send({ email: admin.email, password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(res.body)).not.toMatch(/hash|bcrypt|\$2[ab]\$/);
  });

  it('rejects an unknown account the same way', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'ghost@medicare.tn', password: 'whatever-12' });
    expect(res.status).toBe(401);
  });

  it('refuses a malformed body', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.details.violations).toBeTruthy();
  });

  it('returns the caller and their linked clinical profile on /me', async () => {
    const res = await asSession(patient).get('/api/auth/me').expect(200);
    expect(res.body.user.email).toBe(patient.email);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.profile.id).toBe('Patient_Ahmed');
  });

  it('requires a bearer token', async () => {
    const res = await api().get('/api/patients');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a tampered token', async () => {
    const res = await api().get('/api/patients').set('Authorization', `Bearer ${admin.accessToken}x`);
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token and revokes the family on replay', async () => {
    const session = await login('PATIENT', 'sara@medicare.tn');
    const step1 = await api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200);
    const step2 = await api().post('/api/auth/refresh').send({ refreshToken: step1.body.refreshToken }).expect(200);
    expect(step2.body.refreshToken).not.toBe(step1.body.refreshToken);

    // replaying an already consumed token kills every descendant
    const replay = await api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    const descendant = await api().post('/api/auth/refresh').send({ refreshToken: step2.body.refreshToken });
    expect(descendant.status).toBe(401);
  });

  it('logs out by revoking the presented refresh token', async () => {
    const session = await login('RECEPTIONIST');
    await api().post('/api/auth/logout').send({ refreshToken: session.refreshToken }).expect(200);
    const res = await api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(401);
  });

  it('changes the password and invalidates the running sessions', async () => {
    const session = await login('RECEPTIONIST');
    const res = await asSession(session)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Test-Password-123', newPassword: 'Rotated-9' })
      .expect(200);
    expect(res.body.sessionsRevoked).toBe(true);
    const refreshed = await api().post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(401);
    const wrong = await asSession(session)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'nope-123456', newPassword: 'Rotated-10' });
    expect(wrong.status).toBe(401);
  });

  it('lists the active sessions of the caller', async () => {
    const res = await asSession(otherPatient).get('/api/auth/sessions').expect(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(res.body.sessions.length).toBeGreaterThan(0);
  });
});

describe('role permissions on the entity routes', () => {
  it('keeps master data read-only outside the admin role', async () => {
    for (const session of [doctor, patient, reception]) {
      const res = await asSession(session).delete('/api/diseases/Diabetes');
      expect(res.status, `${session.role} delete diseases`).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect((await asSession(patient).post('/api/doctors').send({})).status).toBe(403);
    expect((await asSession(reception).patch('/api/hospitals/Hospital_Rabta').send({ name: 'Renamed' })).status).toBe(
      403,
    );
  });

  it('keeps patients from creating doctors or tests', async () => {
    expect((await asSession(patient).post('/api/tests').send({})).status).toBe(403);
    expect((await asSession(patient).delete('/api/patients/Patient_Ahmed')).status).toBe(403);
  });

  it('keeps clinical knowledge out of the reception desk', async () => {
    // diagnoses are not part of the receptionist scope, not even for reading
    expect((await asSession(reception).get('/api/tests')).status).toBe(403);
    expect((await asSession(reception).get('/api/tests/BloodTest_001')).status).toBe(403);
    expect((await asSession(reception).post('/api/tests').send({})).status).toBe(403);
    expect((await asSession(reception).patch('/api/tests/BloodTest_001').send({ result: 'Forged' })).status).toBe(403);
  });

  it('reserves patient deletion for ADMIN but lets the reception desk register one', async () => {
    expect((await asSession(doctor).delete('/api/patients/Patient_Ahmed')).status).toBe(403);
    expect((await asSession(reception).delete('/api/patients/Patient_Ahmed')).status).toBe(403);

    const created = await asSession(reception)
      .post('/api/patients')
      .send({
        name: 'Reception Desk Trial',
        age: 34,
        phone: '55123456',
        relations: { doctors: ['Doctor_Salma'], diseases: ['Diabetes'] },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // identity and contact data are the receptionist's to maintain
    const patched = await asSession(reception)
      .patch(`/api/patients/${created.body.id}`)
      .send({ name: 'Reception Desk Renamed' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    expect((await asSession(admin).delete(`/api/patients/${created.body.id}`)).status).toBe(200);
  });

  it('lets a doctor edit the diagnosis but never the identity', async () => {
    const diagnosis = await asSession(doctor)
      .patch('/api/patients/Patient_Ahmed')
      .send({ relations: { diseases: ['Diabetes', 'Hypertension'] } });
    expect(diagnosis.status, JSON.stringify(diagnosis.body)).toBe(200);
    expect((diagnosis.body.relations.diseases as { id: string }[]).map((d) => d.id).sort()).toEqual([
      'Diabetes',
      'Hypertension',
    ]);

    for (const body of [{ name: 'Renamed By Doctor' }, { age: 30 }, { relations: { doctors: ['Doctor_Hatem'] } }]) {
      const res = await asSession(doctor).patch('/api/patients/Patient_Ahmed').send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.message).toMatch(/Reserved field/);
    }
  });

  it('treats the reserved type key as a restricted field', async () => {
    // a doctor owns the diagnosis list, not the class assertions of a patient
    const res = await asSession(doctor)
      .patch('/api/patients/Patient_Ahmed')
      .send({ types: ['ChronicPatient'] });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toMatch(/Reserved field/);
  });

  it('lets a doctor create a test but not a patient', async () => {
    expect((await asSession(doctor).post('/api/patients').send({})).status).toBe(403);
    const created = await asSession(doctor)
      .post('/api/tests')
      .send({ types: ['BloodTest'], date: '2026-06-01T09:00:00', result: 'Normal', relations: { patient: ['Patient_Ahmed'] } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });

  it('refuses a restricted field with a clear 403', async () => {
    const asPatient = await asSession(patient)
      .patch('/api/patients/Patient_Ahmed')
      .send({ name: 'Hacked Name', age: 5 });
    expect(asPatient.status).toBe(403);
    expect(asPatient.body.code).toBe('FORBIDDEN');
    expect(asPatient.body.message).toMatch(/Reserved field/);

    const asDoctor = await asSession(doctor).patch('/api/patients/Patient_Ahmed').send({ phone: '12345678' });
    expect(asDoctor.status).toBe(403);

    const ownFields = await asSession(patient).patch('/api/patients/Patient_Ahmed').send({ bloodType: 'A+' });
    expect(ownFields.status, JSON.stringify(ownFields.body)).toBe(200);
    expect(ownFields.body.fields.bloodType).toBe('A+');
  });

  it('exposes the permission matrix so the UI can hide forbidden actions', async () => {
    const res = await asSession(doctor).get('/api/permissions/matrix').expect(200);
    expect(res.body.role).toBe('DOCTOR');
    expect(res.body.permissions.tests).toContain('create');
    // medical info only: the field allow-list is what keeps identity safe
    expect(res.body.permissions.patients).toEqual(['read', 'update']);
    expect(res.body.permissions.tests).toEqual(['read', 'create', 'update']);
    expect(res.body.matrix.ADMIN.patients).toContain('delete');
    expect(res.body.writableFields.patients).toEqual(['diseases']);
    expect(res.body.writableFields.appointments).toEqual(['status', 'date', 'type', 'department', 'patient']);
    expect(res.body.matrix.RECEPTIONIST.tests).toBeUndefined();

    const asReception = await asSession(reception).get('/api/permissions/matrix').expect(200);
    expect(asReception.body.permissions.patients).toEqual(['read', 'create', 'update']);
    expect(asReception.body.writableFields.patients).toBe('all');
    expect(asReception.body.permissions.appointments).toEqual(['read', 'create', 'update', 'delete']);
  });

  it('restricts account administration to ADMIN', async () => {
    for (const session of [reception, doctor, patient]) {
      expect((await asSession(session).get('/api/users')).status).toBe(403);
    }
    const res = await asSession(admin).get('/api/users').expect(200);
    expect(res.body.items).toHaveLength(7);
  });

  it('creates, patches and deletes an account through the API', async () => {
    const created = await asSession(admin)
      .post('/api/users')
      .send({
        email: 'temp.reception@medicare.tn',
        password: 'Temp-Password-9',
        fullName: 'Temp Reception',
        role: 'RECEPTIONIST',
      })
      .expect(201);
    expect(created.body).not.toHaveProperty('passwordHash');

    const patched = await asSession(admin).patch(`/api/users/${created.body.id}`).send({ active: false }).expect(200);
    expect(patched.body.active).toBe(false);

    const loginDisabled = await api().post('/api/auth/login').send({ email: 'temp.reception@medicare.tn', password: 'Temp-Password-9' });
    expect(loginDisabled.status).toBe(401);

    expect((await asSession(admin).delete(`/api/users/${created.body.id}`)).status).toBe(200);
  });

  it('refuses an incomplete PATIENT link and a duplicate e-mail', async () => {
    const unlinked = await asSession(admin).post('/api/users').send({
      email: 'orphan@medicare.tn',
      password: 'Temp-Password-9',
      fullName: 'Orphan Account',
      role: 'PATIENT',
    });
    expect(unlinked.status).toBe(400);

    const duplicate = await asSession(admin).post('/api/users').send({
      email: admin.email,
      password: 'Temp-Password-9',
      fullName: 'Copycat',
      role: 'ADMIN',
    });
    expect(duplicate.status).toBe(409);
  });

  it('will not let ADMIN lock themselves out', async () => {
    const me = await asSession(admin).get('/api/auth/me').expect(200);
    const res = await asSession(admin).delete(`/api/users/${me.body.user.id}`);
    expect(res.status).toBe(400);
  });
});

describe('row level security in SPARQL', () => {
  it('shows a patient only their own record', async () => {
    const list = await asSession(patient).get('/api/patients?pageSize=100').expect(200);
    const ids = (list.body.items as { id: string }[]).map((i) => i.id);
    expect(ids).toEqual(['Patient_Ahmed']);
    expect(list.body.total).toBe(1);
  });

  it('shows a doctor only the patients they treat', async () => {
    const list = await asSession(doctor).get('/api/patients?pageSize=100').expect(200);
    expect((list.body.items as { id: string }[]).map((i) => i.id).sort()).toEqual([
      'Patient_Ahmed',
      'Patient_Sara',
      'Patient_Youssef',
    ]);
  });

  it('lets the back office see everybody', async () => {
    const list = await asSession(admin).get('/api/patients?pageSize=100').expect(200);
    expect(list.body.total).toBeGreaterThan(3);
  });

  it('403s a direct read of a record outside the scope', async () => {
    expect((await asSession(patient).get('/api/patients/Patient_Mariam')).status).toBe(403);
    expect((await asSession(otherDoctor).get('/api/patients/Patient_Ahmed')).status).toBe(403);
    expect((await asSession(doctor).get('/api/patients/Patient_Mariam')).status).toBe(403);
    expect((await asSession(doctor).get('/api/patients/Patient_Sara')).status).toBe(200);
  });

  it('scopes appointments and tests through their patient', async () => {
    const mine = await asSession(patient).get('/api/appointments?pageSize=100').expect(200);
    for (const item of mine.body.items as { relations: { patient: { id: string } | null } }[])
      expect(item.relations.patient?.id).toBe('Patient_Ahmed');

    const doctorAppointments = await asSession(doctor).get('/api/appointments?pageSize=100').expect(200);
    expect(doctorAppointments.body.total).toBeGreaterThan(0);
    for (const item of doctorAppointments.body.items as { relations: { patient: { id: string } | null } }[])
      expect(['Patient_Ahmed', 'Patient_Sara', 'Patient_Youssef']).toContain(item.relations.patient?.id);

    expect((await asSession(otherDoctor).get('/api/tests/BloodTest_001')).status).toBe(403);
    expect((await asSession(doctor).get('/api/tests/BloodTest_001')).status).toBe(200);
  });

  it('keeps reference data readable for every authenticated role', async () => {
    for (const session of [patient, doctor, reception, admin]) {
      const res = await asSession(session).get('/api/diseases');
      expect(res.status, session.role).toBe(200);
    }
  });

  it('books a visit for the signed-in patient and never for somebody else', async () => {
    const res = await asSession(patient).post('/api/appointments').send({
      types: ['Consultation'],
      date: '2027-01-08T10:00:00',
      relations: { patient: ['Patient_Sara'], department: ['GeneralMedicineDepartment_01'] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.relations.patient.id).toBe('Patient_Ahmed');
    expect(res.body.fields.status).toBe('Pending');

    const reserved = await asSession(patient).post('/api/appointments').send({
      types: ['Consultation'],
      date: '2027-01-09T10:00:00',
      status: 'Confirmed',
      relations: { department: ['GeneralMedicineDepartment_01'] },
    });
    expect(reserved.status).toBe(403);
    expect(reserved.body.message).toMatch(/Reserved field/);
  });

  it('will not let a doctor attach a record to a patient they do not follow', async () => {
    const res = await asSession(doctor).post('/api/tests').send({
      types: ['BloodTest'],
      date: '2026-07-01T08:00:00',
      result: 'Pending review',
      relations: { patient: ['Patient_Mariam'] },
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/outside the scope/);

    const own = await asSession(doctor).post('/api/tests').send({
      types: ['BloodTest'],
      date: '2026-07-01T08:00:00',
      result: 'Hemoglobin 14 g/dL',
      relations: { patient: ['Patient_Sara'] },
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
  });
});

describe('audit trail', () => {
  it('records logins, writes and denials, and never stores a password', async () => {
    const before = listAudit(500).length;
    await asSession(admin).post('/api/patients').send({
      name: 'Monia Karoui',
      age: 47,
      gender: 'Female',
      relations: { doctors: ['Doctor_Salma'], diseases: ['Diabetes'] },
    }).expect(201);
    await asSession(patient).delete('/api/patients/Patient_Mariam').expect(403);
    const after = listAudit(500);
    expect(after.length).toBeGreaterThan(before);

    const actions = new Set(after.map((entry) => entry.action));
    expect(actions).toContain('LOGIN');
    expect(actions).toContain('CREATE');
    const json = JSON.stringify(after.slice(0, 60));
    expect(json).not.toMatch(/Test-Password-123/);
  });

  it('is only readable by ADMIN and supports filtering', async () => {
    expect((await asSession(reception).get('/api/audit')).status).toBe(403);
    const res = await asSession(admin).get('/api/audit?limit=5&action=CREATE').expect(200);
    for (const entry of res.body.items as { action: string }[]) expect(entry.action).toBe('CREATE');
  });
});

/**
 * The two public self-service routes. This block seeds exactly one account and
 * one Patient individual, both removed by its afterAll; the demo graph and the
 * demo passwords are left untouched.
 */
describe('patient self-registration', () => {
  const email = 'zayneb.selfregistered@medicare.tn';
  const password = 'Self-Registered-9';
  const fullName = 'Zayneb Selfregistered';
  let patientId = '';
  let accountId = 0;

  afterAll(async () => {
    if (accountId > 0) await asSession(admin).delete(`/api/users/${accountId}`);
    if (patientId) await asSession(admin).delete(`/api/patients/${patientId}`);
  });

  it('creates the account and its Patient individual together', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email, password, fullName, birthDate: '1990-04-12', gender: 'Female', phone: '55120033', locale: 'en' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    patientId = res.body.patient.id as string;
    accountId = res.body.account.id as number;
    expect(patientId).toBe('Patient_ZaynebSelfregistered');
    expect(res.body.account).toMatchObject({ email, role: 'PATIENT', fullName, linkedId: patientId, active: true, locale: 'en' });
    expect(res.body.account).not.toHaveProperty('passwordHash');
    expect(res.body.account).not.toHaveProperty('password');
    expect(JSON.stringify(res.body)).not.toMatch(/hash|bcrypt|\$2[ab]\$/);
  });

  it('writes the individual through the ontology writer, types and label included', async () => {
    const item = await entityRepo.getById(entityDef('patients'), patientId);
    expect(item, `Patient ${patientId} is missing from the store`).not.toBeNull();
    expect(item?.label).toBe(fullName);
    expect(item?.fields.name).toBe(fullName);
    expect(item?.fields.gender).toBe('Female');
    expect(item?.fields.phone).toBe('55120033');
    // :hasAge comes from birthDate, so the declared age range of the ontology holds
    const age = Number(item?.fields.age);
    expect(age).toBeGreaterThanOrEqual(18);
    expect(age).toBeLessThan(65);
    expect(item?.types).toContain('Patient');
    expect(item?.types).toContain('AdultPatient');
    expect(item?.types).toContain('NamedIndividual');
    expect(item?.types).not.toContain('ChildPatient');
    expect(item?.types).not.toContain('ElderlyPatient');
  });

  it('lets the new account read its own record with its token', async () => {
    const session = await api().post('/api/auth/login').send({ email, password }).expect(200);
    const me = await api().get('/api/auth/me').set(bearer(session.body.accessToken as string)).expect(200);
    expect(me.body.user.role).toBe('PATIENT');
    expect(me.body.profile.id).toBe(patientId);
    const record = await api().get(`/api/patients/${patientId}`).set(bearer(session.body.accessToken as string)).expect(200);
    expect(record.body.label).toBe(fullName);
    // somebody else's file stays out of reach
    expect((await api().get('/api/patients/Patient_Ahmed').set(bearer(session.body.accessToken as string))).status).toBe(403);
  });

  it('refuses an e-mail that is already taken and creates no individual', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email, password, fullName: 'Duplicate Attempt', birthDate: '1985-01-20', gender: 'Male' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(await entityRepo.findByDataProperty(entityDef('patients'), 'hasName', 'Duplicate Attempt')).toHaveLength(0);
  });

  it('refuses a weak password and a birthDate in the future', async () => {
    const weak = await api()
      .post('/api/auth/register')
      .send({ email: 'weak.password@medicare.tn', password: 'onlyletters', fullName: 'Weak Attempt', birthDate: '1990-01-01', gender: 'Male' });
    expect(weak.status).toBe(400);
    expect((weak.body.details.violations as string[]).join(' ')).toMatch(/password/i);
    expect(await entityRepo.findByDataProperty(entityDef('patients'), 'hasName', 'Weak Attempt')).toHaveLength(0);

    const future = await api()
      .post('/api/auth/register')
      .send({ email: 'future.birthday@medicare.tn', password, fullName: 'Future Attempt', birthDate: '2999-01-01', gender: 'Male' });
    expect(future.status).toBe(400);
    expect((future.body.details.violations as string[]).join(' ')).toMatch(/birthDate/);
    expect(await entityRepo.findByDataProperty(entityDef('patients'), 'hasName', 'Future Attempt')).toHaveLength(0);
  });

  it('keeps the mandatory clinical links for the back office writes', async () => {
    // the intake exemption is opt-in: a receptionist still has to assign a doctor
    const res = await asSession(reception).post('/api/patients').send({ name: 'Unassigned Attempt', age: 30 });
    expect(res.status).toBe(422);
    expect((res.body.details.violations as string[]).join(' ')).toMatch(/at least one doctor/i);
    expect(await entityRepo.findByDataProperty(entityDef('patients'), 'hasName', 'Unassigned Attempt')).toHaveLength(0);
  });

  it('audits the registration without the password', () => {
    const entry = listAudit(200, { action: 'REGISTER' }).find((e) => e.resourceId === patientId);
    expect(entry, 'no REGISTER audit entry').toBeDefined();
    expect(entry?.email).toBe(email);
    expect(entry?.role).toBe('PATIENT');
    expect(entry?.status).toBe(201);
    expect(JSON.parse(String(entry?.details))).toMatchObject({ email, fullName, gender: 'Female' });
    expect(entry?.details).not.toMatch(/password/i);
  });

  it('answers a forgotten password the same way for an unknown e-mail', async () => {
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost.account@medicare.tn' }).expect(200);
    const known = await api().post('/api/auth/forgot-password').send({ email: patient.email }).expect(200);
    expect(unknown.body).toEqual({ ok: true, delivered: false });
    expect(known.body).toEqual(unknown.body);

    const bad = await api().post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);

    const attempts = listAudit(20, { action: 'PASSWORD_RESET_REQUEST' });
    // the malformed body is rejected by the schema, before the audit row
    expect(attempts.length).toBe(2);
    for (const attempt of attempts) {
      expect(attempt.userId).toBeNull();
      expect(attempt.status).toBe(200);
    }
    expect(attempts.some((a) => a.details?.includes('ghost.account@medicare.tn'))).toBe(true);
  });
});
