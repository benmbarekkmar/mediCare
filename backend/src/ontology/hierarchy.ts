/**
 * Static view of the OWL class hierarchy of MedicCare, used by the writer to keep
 * Fuseki materialized (Fuseki runs without a reasoner). Mirrors
 * `backend/ontology/MedicCare_final_fuseki_en.ttl` exactly.
 */

import { PATIENT_AGE_CLASSES, SPECIALTY_TO_DEPARTMENT } from './registry';

export const CLASS_PARENTS: Record<string, string | undefined> = {
  Patient: undefined,
  ChildPatient: 'Patient',
  AdultPatient: 'Patient',
  ElderlyPatient: 'Patient',
  ChronicPatient: 'Patient',
  EmergencyPatient: 'Patient',

  Doctor: undefined,
  GeneralPractitioner: 'Doctor',
  EmergencyPhysician: 'Doctor',
  Cardiologist: 'Doctor',
  Dermatologist: 'Doctor',
  Neurologist: 'Doctor',

  Disease: undefined,
  InfectiousDisease: 'Disease',
  ChronicDisease: 'Disease',
  CardiovascularDisease: 'Disease',
  RespiratoryDisease: 'Disease',

  Symptom: undefined,
  Fever: 'Symptom',
  Headache: 'Symptom',
  Cough: 'Symptom',
  Fatigue: 'Symptom',
  ChestPain: 'Symptom',
  SkinRash: 'Symptom',

  Treatment: undefined,
  MedicationTreatment: 'Treatment',
  SurgicalTreatment: 'Treatment',
  Physiotherapy: 'Treatment',

  Medication: undefined,
  Antibiotic: 'Medication',
  Analgesic: 'Medication',
  Antiviral: 'Medication',
  Antihypertensive: 'Medication',
  Antidiabetic: 'Medication',

  MedicalTest: undefined,
  BloodTest: 'MedicalTest',
  UrineTest: 'MedicalTest',
  XRay: 'MedicalTest',
  MRI: 'MedicalTest',
  CTScan: 'MedicalTest',

  Hospital: undefined,
  PublicHospital: 'Hospital',
  PrivateHospital: 'Hospital',
  UniversityHospital: 'Hospital',

  MedicalAppointment: undefined,
  Consultation: 'MedicalAppointment',
  FollowUpAppointment: 'MedicalAppointment',
  EmergencyAppointment: 'MedicalAppointment',

  MedicalDepartment: undefined,
  CardiologyDepartment: 'MedicalDepartment',
  DermatologyDepartment: 'MedicalDepartment',
  NeurologyDepartment: 'MedicalDepartment',
  EmergencyDepartment: 'MedicalDepartment',
  GeneralMedicineDepartment: 'MedicalDepartment',
};

export const CLASS_LABELS: Record<string, string> = {
  Patient: 'Patient',
  ChildPatient: 'Child Patient',
  AdultPatient: 'Adult Patient',
  ElderlyPatient: 'Elderly Patient',
  ChronicPatient: 'Chronic Patient',
  EmergencyPatient: 'Emergency Patient',
  Doctor: 'Doctor',
  GeneralPractitioner: 'General Practitioner',
  EmergencyPhysician: 'Emergency Physician',
  Cardiologist: 'Cardiologist',
  Dermatologist: 'Dermatologist',
  Neurologist: 'Neurologist',
  Disease: 'Disease',
  InfectiousDisease: 'Infectious Disease',
  ChronicDisease: 'Chronic Disease',
  CardiovascularDisease: 'Cardiovascular Disease',
  RespiratoryDisease: 'Respiratory Disease',
  Symptom: 'Symptom',
  Fever: 'Fever',
  Headache: 'Headache',
  Cough: 'Cough',
  Fatigue: 'Fatigue',
  ChestPain: 'Chest Pain',
  SkinRash: 'Skin Rash',
  Treatment: 'Treatment',
  MedicationTreatment: 'Medication Treatment',
  SurgicalTreatment: 'Surgical Treatment',
  Physiotherapy: 'Physiotherapy',
  Medication: 'Medication',
  Antibiotic: 'Antibiotic',
  Analgesic: 'Analgesic',
  Antiviral: 'Antiviral',
  Antihypertensive: 'Antihypertensive',
  Antidiabetic: 'Antidiabetic',
  MedicalTest: 'Medical Test',
  BloodTest: 'Blood Test',
  UrineTest: 'Urine Test',
  XRay: 'X-Ray',
  MRI: 'MRI',
  CTScan: 'CT Scan',
  Hospital: 'Hospital',
  PublicHospital: 'Public Hospital',
  PrivateHospital: 'Private Hospital',
  UniversityHospital: 'University Hospital',
  MedicalAppointment: 'Medical Appointment',
  Consultation: 'Consultation',
  FollowUpAppointment: 'Follow Up Appointment',
  EmergencyAppointment: 'Emergency Appointment',
  MedicalDepartment: 'Medical Department',
  CardiologyDepartment: 'Cardiology Department',
  DermatologyDepartment: 'Dermatology Department',
  NeurologyDepartment: 'Neurology Department',
  EmergencyDepartment: 'Emergency Department',
  GeneralMedicineDepartment: 'General Medicine Department',
};

export const ancestorChain = (classLocal: string): string[] => {
  const chain: string[] = [classLocal];
  let parent = CLASS_PARENTS[classLocal];
  while (parent) {
    chain.push(parent);
    parent = CLASS_PARENTS[parent];
  }
  return chain;
};

/** Most specific classes + every superclass + the entity root class + NamedIndividual. */
export const closureTypes = (rootClass: string, specific: string[]): string[] => {
  const set = new Set<string>([rootClass]);
  for (const cls of specific) {
    set.add(cls);
    let parent = CLASS_PARENTS[cls];
    while (parent) {
      set.add(parent);
      parent = CLASS_PARENTS[parent];
    }
  }
  set.add('NamedIndividual');
  return [...set];
};

/** `owl:equivalentClass` age ranges of the ontology. */
export const ageClassFor = (age: number): string => {
  if (age < 18) return 'ChildPatient';
  if (age < 65) return 'AdultPatient';
  return 'ElderlyPatient';
};

export const isAgeClass = (cls: string): boolean =>
  (PATIENT_AGE_CLASSES as readonly string[]).includes(cls);

/** Human readable label used for generated individuals. */
export const classHumanLabel = (cls: string): string => CLASS_LABELS[cls] ?? cls;

export const departmentTypeForSpecialty = (specialty: string): string | undefined =>
  SPECIALTY_TO_DEPARTMENT[specialty];
