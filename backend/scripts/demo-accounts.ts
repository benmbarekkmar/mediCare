/**
 * The demo accounts created by "npm run seed" and removed by "npm run reset-db".
 * Every one of them either carries no clinical link or points at an individual
 * that already exists in the loaded ontology.
 */
import type { Role } from '../src/auth/model';

export interface DemoAccount {
  email: string;
  fullName: string;
  role: Role;
  /** local name of the ontology individual this account maps to */
  linkedId?: string;
  linkedEntity?: 'patients' | 'doctors';
  locale: 'fr' | 'en';
  why: string;
}

export const DEMO: DemoAccount[] = [
  {
    email: 'admin@medicare.tn',
    fullName: 'Admin MedicCare',
    role: 'ADMIN',
    locale: 'fr',
    why: 'back office: every entity, users, SPARQL console, NLP assistant',
  },
  {
    email: 'reception@medicare.tn',
    fullName: 'Reception Desk',
    role: 'RECEPTIONIST',
    locale: 'fr',
    why: 'registers patients, books appointments and tests',
  },
  {
    email: 'salma.benali@medicare.tn',
    fullName: 'Dr Salma Ben Ali',
    role: 'DOCTOR',
    linkedId: 'Doctor_Salma',
    linkedEntity: 'doctors',
    locale: 'fr',
    why: 'sees only the patients she follows (treatedBy)',
  },
  {
    email: 'hatem.trabelsi@medicare.tn',
    fullName: 'Dr Hatem Trabelsi',
    role: 'DOCTOR',
    linkedId: 'Doctor_Hatem',
    linkedEntity: 'doctors',
    locale: 'fr',
    why: 'second account to demonstrate row level scoping',
  },
  {
    email: 'ahmed@medicare.tn',
    fullName: 'Ahmed Ben Salah',
    role: 'PATIENT',
    linkedId: 'Patient_Ahmed',
    linkedEntity: 'patients',
    locale: 'fr',
    why: 'front office portal: own file, appointments, results',
  },
  {
    email: 'sara@medicare.tn',
    fullName: 'Sara Hammadi',
    role: 'PATIENT',
    linkedId: 'Patient_Sara',
    linkedEntity: 'patients',
    locale: 'fr',
    why: 'second patient account',
  },
  {
    email: 'nour.elamri@medicare.tn',
    fullName: 'Nour El Amri',
    role: 'ADMIN',
    locale: 'en',
    why: 'English interface sample account',
  },
];

export const DEMO_EMAILS = DEMO.map((a) => a.email);
