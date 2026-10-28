/**
 * Metadata registry: one descriptor per entity drives repositories, validation,
 * axiom checks and the materializing SPARQL writer, so every entity shares the
 * same generic code path.
 */

export type EntityKey =
  | 'patients'
  | 'doctors'
  | 'diseases'
  | 'symptoms'
  | 'treatments'
  | 'medications'
  | 'tests'
  | 'appointments'
  | 'hospitals'
  | 'departments';

export type Datatype = 'string' | 'integer' | 'dateTime' | 'text';

export interface DataPropertyDef {
  predicate: string;
  field: string;
  datatype: Datatype;
  required?: boolean;
  values?: readonly string[];
  unique?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  sortable?: boolean;
  search?: boolean;
  pattern?: string;
}

export interface RelationDef {
  /** predicate asserted on the *subject* side of this entity */
  predicate: string;
  inverse: string;
  target: EntityKey;
  field: string;
  cardinality: 'one' | 'many';
  required?: boolean;
  /** when true the triple is written from the other entity and only read here */
  readOnly?: boolean;
  /** functional in the ontology: update uses DELETE/INSERT instead of append */
  functional?: boolean;
  /** resolved by a join (no stored triple of its own), e.g. hospital -> doctors */
  virtual?: 'hospitalDoctors' | 'departmentOfPatient';
  filterParam?: string;
}

export interface TypeFacetDef {
  field: string;
  classes: readonly string[];
  multiple: boolean;
  required: boolean;
  filterParam: string;
  label: string;
}

export interface EntityDef {
  key: EntityKey;
  label: string;
  plural: string;
  classLocal: string;
  iriPrefix: string;
  idStyle: 'slug' | 'sequence';
  /** sequence/slug prefix comes from the chosen type facet class instead of `iriPrefix` */
  prefixFromType?: boolean;
  nameField: string;
  namePredicate: string;
  data: DataPropertyDef[];
  relations: RelationDef[];
  typeFacet?: TypeFacetDef;
  /** patient classes are derived from age/diseases/appointments */
  derivedPatient?: boolean;
  description: string;
}

export const GENDER_VALUES = ['Male', 'Female'] as const;
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const APPOINTMENT_STATUS = ['Pending', 'Confirmed', 'Completed', 'Cancelled'] as const;

export const PATIENT_AGE_CLASSES = ['ChildPatient', 'AdultPatient', 'ElderlyPatient'] as const;
export const PATIENT_EXTRA_CLASSES = ['ChronicPatient', 'EmergencyPatient'] as const;
export const SPECIALTIES = [
  'GeneralPractitioner',
  'EmergencyPhysician',
  'Cardiologist',
  'Dermatologist',
  'Neurologist',
] as const;
export const DEPARTMENT_TYPES = [
  'CardiologyDepartment',
  'DermatologyDepartment',
  'NeurologyDepartment',
  'EmergencyDepartment',
  'GeneralMedicineDepartment',
] as const;
export const DISEASE_CATEGORIES = [
  'InfectiousDisease',
  'ChronicDisease',
  'CardiovascularDisease',
  'RespiratoryDisease',
] as const;
export const SYMPTOM_TYPES = ['Fever', 'Headache', 'Cough', 'Fatigue', 'ChestPain', 'SkinRash'] as const;
export const TREATMENT_TYPES = ['MedicationTreatment', 'SurgicalTreatment', 'Physiotherapy'] as const;
export const MEDICATION_CLASSES = [
  'Antibiotic',
  'Analgesic',
  'Antiviral',
  'Antihypertensive',
  'Antidiabetic',
] as const;
export const TEST_TYPES = ['BloodTest', 'UrineTest', 'XRay', 'MRI', 'CTScan'] as const;
export const APPOINTMENT_TYPES = ['Consultation', 'FollowUpAppointment', 'EmergencyAppointment'] as const;
export const HOSPITAL_TYPES = ['PublicHospital', 'PrivateHospital', 'UniversityHospital'] as const;

/** Doctor specialty -> the department type it must work in (owl:someValuesFrom axioms). */
export const SPECIALTY_TO_DEPARTMENT: Record<string, string> = {
  GeneralPractitioner: 'GeneralMedicineDepartment',
  EmergencyPhysician: 'EmergencyDepartment',
  Cardiologist: 'CardiologyDepartment',
  Dermatologist: 'DermatologyDepartment',
  Neurologist: 'NeurologyDepartment',
};

export const ENTITY_DEFS: Record<EntityKey, EntityDef> = {
  patients: {
    key: 'patients',
    label: 'Patient',
    plural: 'Patients',
    classLocal: 'Patient',
    iriPrefix: 'Patient_',
    idStyle: 'slug',
    nameField: 'name',
    namePredicate: 'hasName',
    derivedPatient: true,
    description: 'A person receiving medical care.',
    data: [
      {
        predicate: 'hasName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        maxLength: 120,
      },
      {
        predicate: 'hasAge',
        field: 'age',
        datatype: 'integer',
        required: true,
        min: 0,
        max: 120,
        sortable: true,
      },
      { predicate: 'hasGender', field: 'gender', datatype: 'string', values: GENDER_VALUES },
      { predicate: 'hasBloodType', field: 'bloodType', datatype: 'string', values: BLOOD_TYPES },
      {
        predicate: 'hasPhoneNumber',
        field: 'phone',
        datatype: 'string',
        search: true,
        pattern: '^[0-9+ ]{6,20}$',
        maxLength: 20,
      },
    ],
    relations: [
      {
        predicate: 'treatedBy',
        inverse: 'treats',
        target: 'doctors',
        field: 'doctors',
        cardinality: 'many',
        required: true,
        filterParam: 'doctor',
      },
      {
        predicate: 'hasDisease',
        inverse: 'isDiseaseOf',
        target: 'diseases',
        field: 'diseases',
        cardinality: 'many',
        required: true,
        filterParam: 'disease',
      },
      {
        predicate: 'hasAppointment',
        inverse: 'appointmentOf',
        target: 'appointments',
        field: 'appointments',
        cardinality: 'many',
        readOnly: true,
      },
      {
        predicate: 'undergoesTest',
        inverse: 'isTestOf',
        target: 'tests',
        field: 'tests',
        cardinality: 'many',
        readOnly: true,
      },
      // filled by the materializer (property chains), never written by hand
      {
        predicate: 'followedInDepartment',
        inverse: 'followedInDepartment',
        target: 'departments',
        field: 'department',
        cardinality: 'one',
        readOnly: true,
      },
      {
        predicate: 'followedInHospital',
        inverse: 'followedInHospital',
        target: 'hospitals',
        field: 'hospital',
        cardinality: 'one',
        readOnly: true,
      },
    ],
  },
  doctors: {
    key: 'doctors',
    label: 'Doctor',
    plural: 'Doctors',
    classLocal: 'Doctor',
    iriPrefix: 'Doctor_',
    idStyle: 'slug',
    nameField: 'name',
    namePredicate: 'doctorName',
    description: 'A licensed physician working in one department.',
    data: [
      {
        predicate: 'doctorName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        maxLength: 120,
      },
      {
        predicate: 'doctorLicenseNumber',
        field: 'licenseNumber',
        datatype: 'string',
        required: true,
        unique: true,
        search: true,
        pattern: '^[A-Z]{2,4}-[0-9]{3,10}$',
        maxLength: 20,
      },
    ],
    relations: [
      {
        predicate: 'worksIn',
        inverse: 'hasDoctor',
        target: 'departments',
        field: 'department',
        cardinality: 'one',
        required: true,
        functional: true,
        filterParam: 'department',
      },
      {
        predicate: 'treats',
        inverse: 'treatedBy',
        target: 'patients',
        field: 'patients',
        cardinality: 'many',
        readOnly: true,
      },
    ],
    typeFacet: {
      field: 'specialty',
      classes: SPECIALTIES,
      multiple: false,
      required: true,
      filterParam: 'specialty',
      label: 'Specialty',
    },
  },
  diseases: {
    key: 'diseases',
    label: 'Disease',
    plural: 'Diseases',
    classLocal: 'Disease',
    iriPrefix: '',
    idStyle: 'slug',
    nameField: 'name',
    namePredicate: 'diseaseName',
    description: 'A medical condition with symptoms and treatments.',
    data: [
      {
        predicate: 'diseaseName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        unique: true,
        maxLength: 120,
      },
      {
        predicate: 'diseaseDescription',
        field: 'description',
        datatype: 'text',
        search: true,
        maxLength: 500,
      },
    ],
    relations: [
      {
        predicate: 'hasSymptom',
        inverse: 'isSymptomOf',
        target: 'symptoms',
        field: 'symptoms',
        cardinality: 'many',
        required: true,
      },
      {
        predicate: 'hasTreatment',
        inverse: 'isTreatmentOf',
        target: 'treatments',
        field: 'treatments',
        cardinality: 'many',
        required: true,
      },
      {
        predicate: 'isDiseaseOf',
        inverse: 'hasDisease',
        target: 'patients',
        field: 'patients',
        cardinality: 'many',
        readOnly: true,
      },
    ],
    typeFacet: {
      field: 'categories',
      classes: DISEASE_CATEGORIES,
      multiple: true,
      required: false,
      filterParam: 'category',
      label: 'Category',
    },
  },
  symptoms: {
    key: 'symptoms',
    label: 'Symptom',
    plural: 'Symptoms',
    classLocal: 'Symptom',
    iriPrefix: '',
    idStyle: 'sequence',
    prefixFromType: true,
    nameField: 'name',
    namePredicate: 'symptomName',
    description: 'A clinical sign reported by patients.',
    data: [
      {
        predicate: 'symptomName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        maxLength: 120,
      },
    ],
    relations: [
      {
        predicate: 'isSymptomOf',
        inverse: 'hasSymptom',
        target: 'diseases',
        field: 'diseases',
        cardinality: 'many',
        readOnly: true,
      },
    ],
    typeFacet: {
      field: 'type',
      classes: SYMPTOM_TYPES,
      multiple: false,
      required: true,
      filterParam: 'type',
      label: 'Symptom type',
    },
  },
  treatments: {
    key: 'treatments',
    label: 'Treatment',
    plural: 'Treatments',
    classLocal: 'Treatment',
    iriPrefix: '',
    idStyle: 'slug',
    nameField: 'name',
    namePredicate: 'treatmentName',
    description: 'A therapeutic approach applied to a disease.',
    data: [
      {
        predicate: 'treatmentName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        maxLength: 160,
      },
      {
        predicate: 'treatmentDuration',
        field: 'duration',
        datatype: 'string',
        search: true,
        maxLength: 80,
      },
    ],
    relations: [
      {
        predicate: 'usesMedication',
        inverse: 'isUsedIn',
        target: 'medications',
        field: 'medications',
        cardinality: 'many',
      },
      {
        predicate: 'isTreatmentOf',
        inverse: 'hasTreatment',
        target: 'diseases',
        field: 'diseases',
        cardinality: 'many',
        readOnly: true,
      },
    ],
    typeFacet: {
      field: 'type',
      classes: TREATMENT_TYPES,
      multiple: false,
      required: true,
      filterParam: 'type',
      label: 'Treatment type',
    },
  },
  medications: {
    key: 'medications',
    label: 'Medication',
    plural: 'Medications',
    classLocal: 'Medication',
    iriPrefix: '',
    idStyle: 'slug',
    nameField: 'name',
    namePredicate: 'medicationName',
    description: 'A drug used inside a treatment.',
    data: [
      {
        predicate: 'medicationName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        unique: true,
        maxLength: 120,
      },
      {
        predicate: 'medicationDosage',
        field: 'dosage',
        datatype: 'string',
        search: true,
        maxLength: 60,
      },
    ],
    relations: [
      {
        predicate: 'isUsedIn',
        inverse: 'usesMedication',
        target: 'treatments',
        field: 'treatments',
        cardinality: 'many',
        readOnly: true,
      },
    ],
    typeFacet: {
      field: 'drugClass',
      classes: MEDICATION_CLASSES,
      multiple: false,
      required: false,
      filterParam: 'class',
      label: 'Pharmacological class',
    },
  },
  tests: {
    key: 'tests',
    label: 'Medical Test',
    plural: 'Medical Tests',
    classLocal: 'MedicalTest',
    iriPrefix: '',
    idStyle: 'sequence',
    prefixFromType: true,
    nameField: 'label',
    namePredicate: 'testResult',
    description: 'A diagnostic examination performed for a patient.',
    data: [
      {
        predicate: 'testDate',
        field: 'date',
        datatype: 'dateTime',
        required: true,
        sortable: true,
      },
      {
        predicate: 'testResult',
        field: 'result',
        datatype: 'string',
        required: true,
        search: true,
        maxLength: 300,
      },
    ],
    relations: [
      {
        predicate: 'isTestOf',
        inverse: 'undergoesTest',
        target: 'patients',
        field: 'patient',
        cardinality: 'one',
        required: true,
        functional: true,
        filterParam: 'patient',
      },
    ],
    typeFacet: {
      field: 'type',
      classes: TEST_TYPES,
      multiple: false,
      required: true,
      filterParam: 'type',
      label: 'Test type',
    },
  },
  appointments: {
    key: 'appointments',
    label: 'Medical Appointment',
    plural: 'Appointments',
    classLocal: 'MedicalAppointment',
    iriPrefix: 'Appointment_',
    idStyle: 'sequence',
    nameField: 'label',
    namePredicate: 'appointmentStatus',
    description: 'A scheduled visit between a patient and a department.',
    data: [
      {
        predicate: 'appointmentDate',
        field: 'date',
        datatype: 'dateTime',
        required: true,
        sortable: true,
      },
      {
        predicate: 'appointmentStatus',
        field: 'status',
        datatype: 'string',
        required: true,
        values: APPOINTMENT_STATUS,
        sortable: true,
      },
    ],
    relations: [
      {
        predicate: 'appointmentOf',
        inverse: 'hasAppointment',
        target: 'patients',
        field: 'patient',
        cardinality: 'one',
        required: true,
        functional: true,
        filterParam: 'patient',
      },
      {
        predicate: 'belongsToDepartment',
        inverse: 'includesAppointment',
        target: 'departments',
        field: 'department',
        cardinality: 'one',
        required: true,
        functional: true,
        filterParam: 'department',
      },
    ],
    typeFacet: {
      field: 'type',
      classes: APPOINTMENT_TYPES,
      multiple: false,
      required: true,
      filterParam: 'type',
      label: 'Appointment type',
    },
  },
  hospitals: {
    key: 'hospitals',
    label: 'Hospital',
    plural: 'Hospitals',
    classLocal: 'Hospital',
    iriPrefix: 'Hospital_',
    idStyle: 'slug',
    nameField: 'name',
    namePredicate: 'hospitalName',
    description: 'A healthcare institution hosting departments.',
    data: [
      {
        predicate: 'hospitalName',
        field: 'name',
        datatype: 'string',
        required: true,
        unique: true,
        sortable: true,
        search: true,
        maxLength: 160,
      },
    ],
    relations: [
      {
        predicate: 'hasDepartment',
        inverse: 'locatedIn',
        target: 'departments',
        field: 'departments',
        cardinality: 'many',
        readOnly: true,
      },
      {
        predicate: 'hasDoctor',
        inverse: 'worksIn',
        target: 'doctors',
        field: 'doctors',
        cardinality: 'many',
        readOnly: true,
        virtual: 'hospitalDoctors',
      },
    ],
    typeFacet: {
      field: 'type',
      classes: HOSPITAL_TYPES,
      multiple: false,
      required: true,
      filterParam: 'type',
      label: 'Hospital type',
    },
  },
  departments: {
    key: 'departments',
    label: 'Medical Department',
    plural: 'Departments',
    classLocal: 'MedicalDepartment',
    iriPrefix: '',
    idStyle: 'sequence',
    prefixFromType: true,
    nameField: 'name',
    namePredicate: 'departmentName',
    description: 'A clinical unit inside exactly one hospital.',
    data: [
      {
        predicate: 'departmentName',
        field: 'name',
        datatype: 'string',
        required: true,
        sortable: true,
        search: true,
        maxLength: 160,
      },
    ],
    relations: [
      {
        predicate: 'locatedIn',
        inverse: 'hasDepartment',
        target: 'hospitals',
        field: 'hospital',
        cardinality: 'one',
        required: true,
        functional: true,
        filterParam: 'hospital',
      },
      {
        predicate: 'hasDoctor',
        inverse: 'worksIn',
        target: 'doctors',
        field: 'doctors',
        cardinality: 'many',
        readOnly: true,
      },
      {
        predicate: 'includesAppointment',
        inverse: 'belongsToDepartment',
        target: 'appointments',
        field: 'appointments',
        cardinality: 'many',
        readOnly: true,
      },
    ],
    typeFacet: {
      field: 'type',
      classes: DEPARTMENT_TYPES,
      multiple: false,
      required: true,
      filterParam: 'type',
      label: 'Department type',
    },
  },
};

export const ENTITY_KEYS = Object.keys(ENTITY_DEFS) as EntityKey[];

export const entityDef = (key: EntityKey): EntityDef => ENTITY_DEFS[key];

export const isEntityKey = (value: string): value is EntityKey =>
  Object.prototype.hasOwnProperty.call(ENTITY_DEFS, value);

/** All object properties (both directions) that the writer is allowed to manage. */
export const MANAGED_OBJECT_PROPERTIES = (() => {
  const set = new Set<string>();
  for (const def of ENTITY_KEYS.map((k) => ENTITY_DEFS[k])) {
    for (const rel of def.relations) {
      set.add(rel.predicate);
      set.add(rel.inverse);
    }
  }
  set.add('followedInDepartment');
  set.add('followedInHospital');
  return [...set].sort();
})();

export const MANAGED_DATA_PROPERTIES = (() => {
  const set = new Set<string>();
  for (const def of ENTITY_KEYS.map((k) => ENTITY_DEFS[k])) {
    for (const p of def.data) set.add(p.predicate);
  }
  return [...set].sort();
})();

/** entity defs exposing a given field name, used for documentation */
export const dataFieldOf = (def: EntityDef, field: string): DataPropertyDef | undefined =>
  def.data.find((d) => d.field === field);

export const relationOf = (def: EntityDef, field: string): RelationDef | undefined =>
  def.relations.find((r) => r.field === field);
