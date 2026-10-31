import type { Action, EntityKey, Role } from '../core/api/models';
import type { IconName } from '../shared/ui/icon/icons';

export interface NavItem {
  /** Router link; `/records/<entity>` is the generic metadata-driven collection route. */
  path: string;
  labelKey: string;
  icon: IconName;
  /** Gate: the permission the account must hold, when the item maps to an entity. */
  permission?: { entity: EntityKey; action: Action };
  roles?: Role[];
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const entityItem = (
  entity: EntityKey,
  path: string,
  labelKey: string,
  icon: IconName,
  action: Action = 'read',
): NavItem => ({ path, labelKey, icon, permission: { entity, action } });

/**
 * The sidebar is a data structure, not ten templates: a role sees exactly the
 * entries its permission matrix allows, and the same table drives the mobile
 * drawer and the command palette.
 */
export const BACK_OFFICE_NAV: Record<Role, NavGroup[]> = {
  ADMIN: [
    {
      labelKey: 'nav.groups.overview',
      items: [
        { path: '/admin/dashboard', labelKey: 'nav.items.dashboard', icon: 'dashboard' },
      ],
    },
    {
      labelKey: 'nav.groups.clinical',
      items: [
        entityItem('patients', '/records/patients', 'nav.items.patients', 'users'),
        entityItem('appointments', '/records/appointments', 'nav.items.appointments', 'calendar'),
        entityItem('tests', '/records/tests', 'nav.items.tests', 'flask'),
        { path: '/calendar', labelKey: 'calendar.title', icon: 'calendar-days' },
      ],
    },
    {
      labelKey: 'nav.groups.knowledge',
      items: [
        entityItem('diseases', '/records/diseases', 'nav.items.diseases', 'heart'),
        entityItem('symptoms', '/records/symptoms', 'nav.items.symptoms', 'activity'),
        entityItem('treatments', '/records/treatments', 'nav.items.treatments', 'route'),
        entityItem('medications', '/records/medications', 'nav.items.medications', 'pill'),
      ],
    },
    {
      labelKey: 'nav.groups.organisation',
      items: [
        entityItem('doctors', '/records/doctors', 'nav.items.doctors', 'stethoscope'),
        entityItem('hospitals', '/records/hospitals', 'nav.items.hospitals', 'hospital'),
        entityItem('departments', '/records/departments', 'nav.items.departments', 'building'),
      ],
    },
    {
      labelKey: 'nav.groups.tools',
      items: [
        { path: '/tools/assistant', labelKey: 'nav.items.assistant', icon: 'bot' },
      ],
    },
    {
      labelKey: 'nav.groups.administration',
      items: [
        { path: '/admin/users', labelKey: 'nav.items.users', icon: 'user' },
        { path: '/admin/audit', labelKey: 'nav.items.audit', icon: 'list-checks' },
      ],
    },
  ],
  DOCTOR: [
    {
      labelKey: 'nav.groups.overview',
      items: [{ path: '/doctor/dashboard', labelKey: 'nav.items.dashboard', icon: 'dashboard' }],
    },
    {
      labelKey: 'nav.groups.clinical',
      items: [
        entityItem('patients', '/records/patients', 'nav.items.myPatients', 'users'),
        entityItem('appointments', '/records/appointments', 'nav.items.myAppointments', 'calendar'),
        entityItem('tests', '/records/tests', 'nav.items.tests', 'flask'),
        { path: '/calendar', labelKey: 'calendar.title', icon: 'calendar-days' },
      ],
    },
    {
      labelKey: 'nav.groups.knowledge',
      items: [
        entityItem('diseases', '/records/diseases', 'nav.items.diseases', 'heart'),
        entityItem('symptoms', '/records/symptoms', 'nav.items.symptoms', 'activity'),
        entityItem('treatments', '/records/treatments', 'nav.items.treatments', 'route'),
        entityItem('medications', '/records/medications', 'nav.items.medications', 'pill'),
      ],
    },
    {
      labelKey: 'nav.groups.organisation',
      items: [entityItem('doctors', '/records/doctors', 'nav.items.doctors', 'stethoscope')],
    },
    {
      labelKey: 'nav.groups.tools',
      items: [
        { path: '/tools/assistant', labelKey: 'nav.items.assistant', icon: 'bot' },
      ],
    },
  ],
  RECEPTIONIST: [
    {
      labelKey: 'nav.groups.overview',
      items: [{ path: '/reception/dashboard', labelKey: 'nav.items.dashboard', icon: 'dashboard' }],
    },
    {
      labelKey: 'nav.groups.scheduling',
      items: [
        entityItem('appointments', '/records/appointments', 'nav.items.appointments', 'calendar'),
        { path: '/calendar', labelKey: 'calendar.title', icon: 'calendar-days' },
      ],
    },
    {
      labelKey: 'nav.groups.clinical',
      items: [entityItem('patients', '/records/patients', 'nav.items.patients', 'users')],
    },
    {
      labelKey: 'nav.groups.directory',
      items: [
        entityItem('doctors', '/records/doctors', 'nav.items.doctors', 'stethoscope'),
        entityItem('departments', '/records/departments', 'nav.items.departments', 'building'),
        entityItem('hospitals', '/records/hospitals', 'nav.items.hospitals', 'hospital'),
      ],
    },
  ],
  PATIENT: [],
};

/** The patient portal has its own, shorter and friendlier navigation. */
export const PORTAL_NAV: NavItem[] = [
  { path: '/patient/dashboard', labelKey: 'nav.items.dashboard', icon: 'dashboard' },
  { path: '/patient/record', labelKey: 'nav.items.record', icon: 'file-text' },
  { path: '/patient/appointments', labelKey: 'nav.items.myAppointments', icon: 'calendar' },
  { path: '/patient/request', labelKey: 'nav.items.requestAppointment', icon: 'plus' },
  { path: '/patient/doctors', labelKey: 'nav.items.findDoctor', icon: 'stethoscope' },
  { path: '/patient/library', labelKey: 'nav.items.library', icon: 'book' },
  { path: '/patient/hospitals', labelKey: 'nav.items.hospitals', icon: 'hospital' },
  { path: '/patient/assistant', labelKey: 'nav.items.healthAssistant', icon: 'bot' },
  { path: '/patient/profile', labelKey: 'nav.items.profile', icon: 'user' },
  { path: '/patient/settings', labelKey: 'nav.items.settings', icon: 'settings' },
];
