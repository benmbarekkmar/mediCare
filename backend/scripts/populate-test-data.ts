import { env } from '../src/config/env';
import { localOf } from '../src/sparql/escape';
import { sparql } from '../src/sparql/client';

const NOTE = 'Synthetic local test data. Not real clinical information.';
const LEGACY_NOTE = 'Synthetic demo data generated for local application testing. Not real clinical information.';
const DISEASE_CLASSES = ['Disease', 'InfectiousDisease', 'ChronicDisease', 'CardiovascularDisease', 'RespiratoryDisease'];
const PATIENT_CLASSES = ['Patient', 'ChildPatient', 'AdultPatient', 'ElderlyPatient', 'ChronicPatient', 'EmergencyPatient'];
const DOCTOR_CLASSES = ['Doctor', 'GeneralPractitioner', 'EmergencyPhysician', 'Cardiologist', 'Dermatologist', 'Neurologist'];
const HOSPITAL_TYPES = ['PublicHospital', 'PrivateHospital', 'UniversityHospital'];
const SPECIALTIES = ['GeneralPractitioner', 'EmergencyPhysician', 'Cardiologist', 'Dermatologist', 'Neurologist'];
const DEPARTMENT_TYPES = ['GeneralMedicineDepartment', 'CardiologyDepartment', 'DermatologyDepartment', 'EmergencyDepartment', 'NeurologyDepartment'];
const TEST_TYPES = ['BloodTest', 'UrineTest', 'XRay', 'MRI', 'CTScan'];
const HOSPITAL_NAMES = [
  'Habib Thameur Hospital', 'Mongi Slim Hospital', 'Aziza Othmana Hospital', 'Fattouma Bourguiba University Hospital',
  'Farhat Hached University Hospital', 'Sahloul University Hospital', 'Hedi Chaker University Hospital', 'Tahar Sfar Hospital',
];
const DOCTOR_NAMES = [
  'Dr. Amina Kallel', 'Dr. Youssef Baccouche', 'Dr. Mariem Gharbi', 'Dr. Hichem Ben Salem', 'Dr. Rania Trabelsi',
  'Dr. Nabil Ktari', 'Dr. Ons Jaziri', 'Dr. Kais Bouazizi', 'Dr. Ines Mansour', 'Dr. Farah Dridi', 'Dr. Aymen Chaabane',
  'Dr. Sarra Khemiri', 'Dr. Mohamed Guesmi', 'Dr. Nesrine Bousnina', 'Dr. Amine Sfar', 'Dr. Nadia Hmida',
  'Dr. Tarek Riahi', 'Dr. Leila Karray',
];
const PATIENT_NAMES = [
  'Noura Gharbi', 'Yassine Trabelsi', 'Amina Jaziri', 'Mehdi Ben Amor', 'Rania Kallel', 'Kais Sassi', 'Emna Dridi',
  'Houssem Baccouche', 'Sabrine Khemiri', 'Marwen Riahi', 'Asma Bouazizi', 'Walid Jlassi', 'Hela Mansour', 'Anis Hadded',
  'Samar Guesmi', 'Bilel Ben Salem', 'Aymen Louati', 'Jihene Maalej', 'Farouk Hmida', 'Nesrine Chatti', 'Faten Ktari',
  'Tarek Bouzid', 'Ons Ferjani', 'Ali Rebai', 'Rym Sfar', 'Nabil Abid', 'Mouna Hachicha', 'Wassim Zouari', 'Sana Ben Yedder',
  'Manel Ben Amor', 'Fares Jebali', 'Nadia Karray', 'Bassem Khlifi', 'Olfa Mezni', 'Riadh Charfi', 'Wafa Ben Mustapha',
  'Saifeddine Hmida', 'Sana Ben Saad', 'Ikram Kacem', 'Karim Sassi', 'Dorsaf Mzoughi', 'Seif Ben Jaziri', 'Khadija Ben Youssef',
  'Mahdi Bouhajeb', 'Soumaya Gharbi', 'Nizar Khemiri', 'Donia Ben Rejeb', 'Ghazi Boughanmi', 'Ibtissem Laabidi', 'Sameh Ktari',
  'Meriem Kallel', 'Oussama Mraihi', 'Rihab Jlassi', 'Chokri Ben Hamida', 'Aicha Ben Messaoud', 'Sofiene Hachicha',
  'Amira Zribi', 'Rihem Chouikha', 'Khalil Znaidi', 'Malek Ben Salah',
];

type Row = Record<string, { value: string } | undefined>;
type Person = { id: string; name?: string; department?: string; doctor?: string; hospital?: string };

const literal = (value: string): string =>
  '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

const dateTime = (date: Date): string =>
  '"' + date.toISOString().replace(/\.\d{3}Z$/, 'Z') + '"^^xsd:dateTime';

const stamp = (date: Date): string => date.toISOString().slice(0, 10).replace(/-/g, '');
const idOf = (value: string | undefined): string | undefined => value ? localOf(value) : undefined;
const read = (row: Row, key: string): string | undefined => row[key]?.value;
const readableTestType = (type: string): string => ({
  BloodTest: 'Blood test', UrineTest: 'Urine test', XRay: 'X-ray', MRI: 'MRI scan', CTScan: 'CT scan',
}[type] ?? type);
const readableAppointmentType = (type: string): string => ({
  Consultation: 'Consultation', FollowUpAppointment: 'Follow-up appointment',
}[type] ?? type);

function block(id: string, types: string[], properties: string[]): string {
  return ':' + id + ' a ' + types.map((type) => ':' + type).join(', ') + ' ;\n    ' + properties.join(' ;\n    ') + ' .';
}

function links(subject: string, predicate: string, objects: string[]): string {
  return ':' + subject + ' :' + predicate + ' ' + objects.map((id) => ':' + id).join(', ') + ' .';
}

function uniquePush(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

async function main(): Promise<void> {
  if (env.NODE_ENV !== 'development' || env.FUSEKI_DATASET !== 'medicare') {
    throw new Error('Test data can only be added to the local development dataset named medicare.');
  }
  const health = await sparql.ping();
  if (!health.ok || health.triples === 0) {
    throw new Error('Fuseki must be running with the existing MedicCare ontology loaded before adding test data.');
  }

  const sampleNotes = literal(LEGACY_NOTE) + '@en ' + literal(NOTE) + '@en';
  await sparql.update('PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o . ?o rdfs:comment ?note . VALUES ?note { ' + sampleNotes + ' } }');
  await sparql.update('PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o ; rdfs:comment ?note . VALUES ?note { ' + sampleNotes + ' } }');
  const patientRows = await sparql.select(
    'PREFIX ont: <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT DISTINCT ?patient ?name ?label ?department ?doctor ?hospital WHERE { ?patient a ?patientClass . VALUES ?patientClass { ' +
      PATIENT_CLASSES.map((name) => 'ont:' + name).join(' ') +
      ' } OPTIONAL { ?patient ont:hasName ?name } OPTIONAL { ?patient rdfs:label ?label } OPTIONAL { ?patient ont:followedInDepartment ?department } OPTIONAL { ?patient ont:treatedBy ?doctor } ' +
      'OPTIONAL { ?patient ont:followedInHospital ?hospital } }',
  );
  const people = new Map<string, Person>();
  for (const row of patientRows.rows) {
    const id = idOf(read(row, 'patient'));
    if (!id) continue;
    const person = people.get(id) ?? { id };
    person.name ??= read(row, 'name') ?? read(row, 'label');
    person.department ??= idOf(read(row, 'department'));
    person.doctor ??= idOf(read(row, 'doctor'));
    person.hospital ??= idOf(read(row, 'hospital'));
    people.set(id, person);
  }

  const diseaseRows = await sparql.select(
    'PREFIX ont: <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>\nSELECT DISTINCT ?disease WHERE { ?disease a ?diseaseClass . VALUES ?diseaseClass { ' +
      DISEASE_CLASSES.map((name) => 'ont:' + name).join(' ') + ' } }',
  );
  const diseaseIds = [...new Set(
    diseaseRows.rows
      .map((row) => idOf(read(row, 'disease')))
      .filter((id): id is string => Boolean(id)),
  )];
  if (diseaseIds.length === 0) throw new Error('No existing ontology diseases were found; refusing to create disconnected patient data.');

  const doctorRows = await sparql.select(
    'PREFIX ont: <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>\nSELECT DISTINCT ?doctor ?department ?hospital WHERE { ?doctor a ?doctorClass . VALUES ?doctorClass { ' +
      DOCTOR_CLASSES.map((name) => 'ont:' + name).join(' ') +
      ' } OPTIONAL { ?doctor ont:worksIn ?department . OPTIONAL { ?department ont:locatedIn ?hospital } } }',
  );
  const doctors = new Map<string, Person>();
  for (const row of doctorRows.rows) {
    const id = idOf(read(row, 'doctor'));
    if (!id) continue;
    const doctor = doctors.get(id) ?? { id };
    doctor.department ??= idOf(read(row, 'department'));
    doctor.hospital ??= idOf(read(row, 'hospital'));
    doctors.set(id, doctor);
  }

  const hospitalIds = Array.from({ length: 8 }, (_, index) => 'Hospital_TN_' + String(index + 1).padStart(2, '0'));
  const departmentIds = Array.from({ length: 18 }, (_, index) =>
    'Department_TN_' + String(index + 1).padStart(2, '0'),
  );
  const sampleDoctorIds = Array.from({ length: 18 }, (_, index) => 'Doctor_TN_' + String(index + 1).padStart(3, '0'));
  const samplePatientIds = Array.from({ length: 60 }, (_, index) => 'Patient_TN_' + String(index + 1).padStart(3, '0'));

  const departmentHospital = new Map<string, string>();
  const departmentDoctors = new Map<string, string[]>();
  const departmentAppointments = new Map<string, string[]>();
  const hospitalDepartments = new Map<string, string[]>();
  const doctorPatients = new Map<string, string[]>();
  const diseasePatients = new Map<string, string[]>();
  const patientAppointments = new Map<string, string[]>();
  const patientTests = new Map<string, string[]>();
  const generated: string[] = [
    '@prefix : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
  ];

  for (let index = 0; index < hospitalIds.length; index++) {
    generated.push(block(hospitalIds[index]!, ['Hospital', ['PublicHospital', 'PrivateHospital', 'UniversityHospital'][index % 3]!], [
      ':hospitalName ' + literal(HOSPITAL_NAMES[index]!),
      'rdfs:label ' + literal(HOSPITAL_NAMES[index]!),
      'rdfs:comment ' + literal(NOTE) + '@en',
    ]));
  }
  for (let index = 0; index < departmentIds.length; index++) {
    const department = departmentIds[index]!;
    const hospital = hospitalIds[index % hospitalIds.length]!;
    departmentHospital.set(department, hospital);
    uniquePush(hospitalDepartments, hospital, department);
  }

  for (let index = 0; index < sampleDoctorIds.length; index++) {
    const id = sampleDoctorIds[index]!;
    const specialty = SPECIALTIES[index % SPECIALTIES.length]!;
    const deptType = DEPARTMENT_TYPES[index % DEPARTMENT_TYPES.length]!;
    const department = departmentIds[index]!;
    const hospital = departmentHospital.get(department) ?? hospitalIds[index % hospitalIds.length]!;
    doctors.set(id, { id, department, hospital });
    uniquePush(departmentDoctors, department, id);
    generated.push(block(id, ['Doctor', specialty], [
      ':doctorName ' + literal(DOCTOR_NAMES[index]!),
      'rdfs:label ' + literal(DOCTOR_NAMES[index]!),
      ':doctorLicenseNumber ' + literal('TN-MED-' + String(index + 1).padStart(5, '0')),
      ':worksIn :' + department,
      'rdfs:comment ' + literal(NOTE) + '@en',
    ]));
  }

  for (let index = 0; index < departmentIds.length; index++) {
    const id = departmentIds[index]!;
    const type = DEPARTMENT_TYPES[index % DEPARTMENT_TYPES.length]!;
    const properties = [
      ':departmentName ' + literal(type.replace(/([a-z])([A-Z])/g, '$1 $2') + ' - ' + HOSPITAL_NAMES[index % HOSPITAL_NAMES.length]!),
      'rdfs:label ' + literal(type.replace(/([a-z])([A-Z])/g, '$1 $2') + ' - ' + HOSPITAL_NAMES[index % HOSPITAL_NAMES.length]!),
      ':locatedIn :' + departmentHospital.get(id),
      'rdfs:comment ' + literal(NOTE) + '@en',
    ];
    const assignedDoctors = departmentDoctors.get(id) ?? [];
    if (assignedDoctors.length) properties.push(':hasDoctor ' + assignedDoctors.map((doctor) => ':' + doctor).join(', '));
    generated.push(block(id, ['MedicalDepartment', type], properties));
  }

  for (const [hospital, departments] of hospitalDepartments) generated.push(links(hospital, 'hasDepartment', departments));
  for (const [department, assignedDoctors] of departmentDoctors) generated.push(links(department, 'hasDoctor', assignedDoctors));

  const existingDoctors = [...doctors.values()].filter((doctor) => !sampleDoctorIds.includes(doctor.id));
  const defaultDepartment = departmentIds[0]!;
  const defaultHospital = departmentHospital.get(defaultDepartment)!;

  for (let index = 0; index < samplePatientIds.length; index++) {
    const id = samplePatientIds[index]!;
    const age = 8 + ((index * 7) % 73);
    const ageClass = age < 18 ? 'ChildPatient' : age >= 65 ? 'ElderlyPatient' : 'AdultPatient';
    const assignedDoctor = index % 3 === 0 && existingDoctors.length
      ? existingDoctors[index % existingDoctors.length]!
      : doctors.get(sampleDoctorIds[index % sampleDoctorIds.length]!)!;
    const department = assignedDoctor.department ?? defaultDepartment;
    const hospital = assignedDoctor.hospital ?? defaultHospital;
    const disease = diseaseIds[index % diseaseIds.length]!;
    uniquePush(doctorPatients, assignedDoctor.id, id);
    uniquePush(diseasePatients, disease, id);
    generated.push(block(id, ['Patient', ageClass], [
      ':hasName ' + literal(PATIENT_NAMES[index]!),
      'rdfs:label ' + literal(PATIENT_NAMES[index]!),
      ':hasAge "' + age + '"^^xsd:integer',
      ':hasGender ' + literal(index % 2 === 0 ? 'Female' : 'Male'),
      ':hasBloodType ' + literal(['A+', 'B+', 'O+', 'AB+'][index % 4]!),
      ':hasPhoneNumber ' + literal('+216 70 ' + String(index + 1).padStart(3, '0') + ' 000'),
      ':treatedBy :' + assignedDoctor.id,
      ':hasDisease :' + disease,
      ':followedInDepartment :' + department,
      ':followedInHospital :' + hospital,
      'rdfs:comment ' + literal(NOTE) + '@en',
    ]));
    people.set(id, { id, name: PATIENT_NAMES[index]!, department, doctor: assignedDoctor.id, hospital });
  }

  for (const person of people.values()) {
    person.department ??= defaultDepartment;
    person.hospital ??= departmentHospital.get(person.department) ?? defaultHospital;
  }
  const allPeople = [...people.values()].sort((left, right) => left.id.localeCompare(right.id));
  const today = new Date();
  const dayStamp = stamp(today);
  const existingTestRows = await sparql.select(
    'PREFIX ont: <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>\n' +
      'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n' +
      'SELECT ?test ?date WHERE { ?test ont:testDate ?date ; rdfs:comment ' + literal(NOTE) + '@en . }',
  );
  const existingTestDates = new Map<string, string>();
  for (const row of existingTestRows.rows) {
    const id = idOf(read(row, 'test'));
    const date = read(row, 'date');
    if (id && date) existingTestDates.set(id, date);
  }

  for (let index = 0; index < allPeople.length; index++) {
    const person = allPeople[index]!;
    const testType = TEST_TYPES[index % TEST_TYPES.length]!;
    const testId = testType + '_' + person.id.replace(/[^A-Za-z0-9_-]/g, '_') + '_' + dayStamp;
    const priorTestDate = existingTestDates.get(testId);
    const testDate = priorTestDate ? new Date(priorTestDate) : new Date(today.getTime() - (index % 45 + 1) * 86400000);
    generated.push(block(testId, ['MedicalTest', testType], [
      ':testDate ' + dateTime(testDate),
      'rdfs:label ' + literal(readableTestType(testType) + ' for ' + (person.name ?? person.id) + ' (' + testDate.toISOString().slice(0, 10) + ')'),
      ':testResult ' + literal('Synthetic UI test result. Not a clinical result.'),
      ':isTestOf :' + person.id,
      'rdfs:comment ' + literal(NOTE) + '@en',
    ]));
    uniquePush(patientTests, person.id, testId);

    for (let slot = 0; slot < 2; slot++) {
      const appointmentDate = new Date(today.getTime());
      appointmentDate.setUTCDate(appointmentDate.getUTCDate() + 2 + (index % 21) + slot * 14);
      appointmentDate.setUTCHours(9 + (index % 7), slot === 0 ? 0 : 30, 0, 0);
      const appointmentId = 'Appointment_TN_' + person.id.replace(/[^A-Za-z0-9_-]/g, '_') + '_' + dayStamp + '_' + String(slot + 1).padStart(2, '0');
      const appointmentType = slot === 0 ? 'Consultation' : 'FollowUpAppointment';
      const status = slot === 0 ? 'Pending' : 'Confirmed';
      generated.push(block(appointmentId, ['MedicalAppointment', appointmentType], [
        ':appointmentDate ' + dateTime(appointmentDate),
        'rdfs:label ' + literal(readableAppointmentType(appointmentType) + ' - ' + (person.name ?? person.id) + ' - ' + appointmentDate.toISOString().slice(0, 10)),
        ':appointmentStatus ' + literal(status),
        ':appointmentOf :' + person.id,
        ':belongsToDepartment :' + person.department,
        'rdfs:comment ' + literal(NOTE) + '@en',
      ]));
      uniquePush(patientAppointments, person.id, appointmentId);
      uniquePush(departmentAppointments, person.department!, appointmentId);
    }
  }

  const dailyStart = new Date();
  dailyStart.setMinutes(0, 0, 0);
  dailyStart.setHours(dailyStart.getHours() + 1);
  if (dailyStart.getHours() < 9) dailyStart.setHours(9);
  if (dailyStart.getHours() >= 17) {
    dailyStart.setDate(dailyStart.getDate() + 1);
    dailyStart.setHours(9);
  }
  const dailyStamp = stamp(dailyStart) + '_' + String(dailyStart.getHours()).padStart(2, '0');
  for (let index = 0; index < Math.min(4, allPeople.length); index++) {
    const person = allPeople[index]!;
    const appointmentDate = new Date(dailyStart.getTime() + index * 30 * 60000);
    const appointmentId = 'Appointment_Today_' + person.id.replace(/[^A-Za-z0-9_-]/g, '_') + '_' + dailyStamp;
    generated.push(block(appointmentId, ['MedicalAppointment', 'Consultation'], [
      ':appointmentDate ' + dateTime(appointmentDate),
      'rdfs:label ' + literal('Consultation - ' + (person.name ?? person.id) + ' - ' + appointmentDate.toISOString().slice(0, 10)),
      ':appointmentStatus ' + literal('Pending'),
      ':appointmentOf :' + person.id,
      ':belongsToDepartment :' + person.department,
      'rdfs:comment ' + literal(NOTE) + '@en',
    ]));
    uniquePush(patientAppointments, person.id, appointmentId);
    uniquePush(departmentAppointments, person.department!, appointmentId);
  }

  for (const [patient, appointments] of patientAppointments) generated.push(links(patient, 'hasAppointment', appointments));
  for (const [patient, tests] of patientTests) generated.push(links(patient, 'undergoesTest', tests));
  for (const [doctor, patients] of doctorPatients) generated.push(links(doctor, 'treats', patients));
  for (const [disease, patients] of diseasePatients) generated.push(links(disease, 'isDiseaseOf', patients));
  for (const [department, appointments] of departmentAppointments) generated.push(links(department, 'includesAppointment', appointments));

  await sparql.uploadTurtle(generated.join('\n') + '\n', { append: true });
  const after = await sparql.ping();
  process.stdout.write(
    'Added named synthetic sample data to local development: ' + samplePatientIds.length + ' patients, ' +
      sampleDoctorIds.length + ' doctors, ' + hospitalIds.length + ' hospitals, ' + departmentIds.length +
      ' departments, ' + (allPeople.length * 2 + Math.min(4, allPeople.length)) +
      ' upcoming appointments, ' + allPeople.length + ' examinations. Fuseki now contains ' +
      after.triples + ' triples.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
