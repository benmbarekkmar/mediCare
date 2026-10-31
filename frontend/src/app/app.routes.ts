import { Routes } from '@angular/router';
import { authEntryGuard, permissionGuard, roleGuard } from './core/auth/guards';

/**
 * Route data carries `title` (a translation key) and `crumbKey` so the shell can
 * build the browser title and the breadcrumb trail without any page wiring them.
 * The catalogue pages are one component fed by `data.entity`: the metadata the
 * back-end serves decides the tiles, the fields and the links, never the route.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'library',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'library.title',
    data: {
      entity: 'diseases',
      icon: 'book',
      titleKey: 'library.title',
      ledeKey: 'library.lede',
      crumbKey: 'nav.items.library',
    },
  },
  {
    path: 'library/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'library.title',
    data: { entity: 'diseases' },
  },
  {
    path: 'symptoms',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'symptoms.title',
    data: {
      entity: 'symptoms',
      icon: 'activity',
      titleKey: 'symptoms.title',
      ledeKey: 'symptoms.lede',
      crumbKey: 'nav.items.symptoms',
    },
  },
  {
    path: 'symptoms/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'symptoms.title',
    data: { entity: 'symptoms' },
  },
  {
    path: 'treatments',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'treatments.title',
    data: {
      entity: 'treatments',
      icon: 'route',
      titleKey: 'treatments.title',
      ledeKey: 'treatments.lede',
      crumbKey: 'nav.items.treatments',
    },
  },
  {
    path: 'treatments/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'treatments.title',
    data: { entity: 'treatments' },
  },
  {
    path: 'medications',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'medications.title',
    data: {
      entity: 'medications',
      icon: 'pill',
      titleKey: 'medications.title',
      ledeKey: 'medications.lede',
      crumbKey: 'nav.items.medications',
    },
  },
  {
    path: 'medications/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'medications.title',
    data: { entity: 'medications' },
  },
  {
    path: 'hospitals',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'directory.title',
    data: {
      entity: 'hospitals',
      icon: 'hospital',
      titleKey: 'directory.title',
      ledeKey: 'directory.lede',
      crumbKey: 'nav.items.hospitals',
    },
  },
  {
    path: 'hospitals/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'directory.title',
    data: { entity: 'hospitals' },
  },
  {
    path: 'departments',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'departments.title',
    data: {
      entity: 'departments',
      icon: 'building',
      titleKey: 'departments.title',
      ledeKey: 'departments.lede',
      crumbKey: 'nav.items.departments',
    },
  },
  {
    path: 'departments/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'departments.title',
    data: { entity: 'departments' },
  },
  {
    path: 'find-a-doctor',
    loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
    title: 'findDoctor.title',
    data: {
      entity: 'doctors',
      icon: 'stethoscope',
      titleKey: 'findDoctor.title',
      ledeKey: 'findDoctor.lede',
      crumbKey: 'nav.items.findDoctor',
    },
  },
  {
    path: 'find-a-doctor/:id',
    loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
    title: 'findDoctor.title',
    data: { entity: 'doctors' },
  },
  {
    path: 'assistant',
    loadComponent: () => import('./features/public/ask.component').then((m) => m.PublicAskComponent),
    title: 'assistant.title',
    data: { crumbKey: 'nav.items.assistant' },
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    title: 'auth.login.title',
    canActivate: [authEntryGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
    title: 'auth.register.title',
    canActivate: [authEntryGuard],
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
    title: 'auth.forgot.title',
  },
  {
    path: 'error',
    children: [
      { path: '', redirectTo: '500', pathMatch: 'full' },
      {
        path: '403',
        loadComponent: () => import('./features/errors/forbidden.component').then((m) => m.ForbiddenComponent),
        title: 'errors.403.title',
      },
      {
        path: '404',
        loadComponent: () => import('./features/errors/not-found.component').then((m) => m.NotFoundComponent),
        title: 'errors.404.title',
      },
      {
        path: '500',
        loadComponent: () => import('./features/errors/server-error.component').then((m) => m.ServerErrorComponent),
        title: 'errors.500.title',
      },
    ],
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    canActivate: [roleGuard('ADMIN', 'DOCTOR', 'RECEPTIONIST')],
    children: [
      {
        path: 'admin',
        children: [
          {
            path: 'dashboard',
            loadComponent: () => import('./features/admin/dashboard.component').then((m) => m.AdminDashboardComponent),
            canActivate: [roleGuard('ADMIN')],
            title: 'admin.dashboard.title',
            data: { crumbKey: 'nav.items.dashboard' },
          },
          {
            path: 'users',
            loadComponent: () => import('./features/admin/users.component').then((m) => m.UsersComponent),
            canActivate: [roleGuard('ADMIN')],
            title: 'admin.users.title',
            data: { crumbKey: 'nav.items.users' },
          },
          {
            path: 'audit',
            loadComponent: () => import('./features/admin/audit.component').then((m) => m.AuditComponent),
            canActivate: [roleGuard('ADMIN')],
            title: 'admin.audit.title',
            data: { crumbKey: 'nav.items.audit' },
          },
          {
            path: 'consistency',
            loadComponent: () => import('./features/admin/consistency.component').then((m) => m.ConsistencyComponent),
            canActivate: [roleGuard('ADMIN')],
            title: 'admin.consistency.title',
            data: { crumbKey: 'nav.items.consistency' },
          },
        ],
      },
      {
        path: 'records',
        children: [
          {
            path: ':entity',
            loadComponent: () => import('./features/records/record-list.component').then((m) => m.RecordListComponent),
            canActivate: [permissionGuard('patients')],
            title: 'records.list.title',
            data: { crumbKey: 'nav.items.records' },
          },
          {
            path: ':entity/:id',
            loadComponent: () => import('./features/records/record-detail.component').then((m) => m.RecordDetailComponent),
            canActivate: [permissionGuard('patients')],
            title: 'records.detail.title',
          },
        ],
      },
      {
        path: 'calendar',
        loadComponent: () => import('./features/calendar/calendar-page.component').then((m) => m.CalendarPageComponent),
        canActivate: [permissionGuard('appointments')],
        title: 'calendar.title',
        data: { crumbKey: 'nav.items.appointments' },
      },
      {
        path: 'doctor',
        children: [
          {
            path: 'dashboard',
            loadComponent: () => import('./features/staff/day.component').then((m) => m.StaffDayComponent),
            canActivate: [roleGuard('DOCTOR')],
            title: 'staff.day.title',
            data: { crumbKey: 'nav.items.dashboard' },
          },
        ],
      },
      {
        path: 'reception',
        children: [
          {
            path: 'dashboard',
            loadComponent: () => import('./features/staff/day.component').then((m) => m.StaffDayComponent),
            canActivate: [roleGuard('RECEPTIONIST')],
            title: 'staff.day.title',
            data: { crumbKey: 'nav.items.dashboard' },
          },
        ],
      },
      {
        path: 'tools',
        children: [
          {
            path: 'assistant',
            loadComponent: () => import('./features/tools/assistant.component').then((m) => m.AssistantComponent),
            canActivate: [roleGuard('ADMIN', 'DOCTOR')],
            title: 'assistant.title',
            data: { crumbKey: 'nav.items.assistant' },
          },
          {
            path: 'console',
            loadComponent: () => import('./features/tools/console.component').then((m) => m.ConsoleComponent),
            canActivate: [roleGuard('ADMIN')],
            title: 'console.title',
            data: { crumbKey: 'nav.items.console' },
          },
          {
            path: 'explorer',
            loadComponent: () => import('./features/tools/explorer.component').then((m) => m.ExplorerComponent),
            canActivate: [roleGuard('ADMIN', 'DOCTOR')],
            title: 'explorer.title',
            data: { crumbKey: 'nav.items.explorer' },
          },
        ],
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
        title: 'profile.title',
        data: { crumbKey: 'nav.items.profile' },
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/profile/settings.component').then((m) => m.SettingsComponent),
        title: 'settings.title',
        data: { crumbKey: 'nav.items.settings' },
      },
    ],
  },
  {
    path: 'patient',
    loadComponent: () => import('./layout/portal-shell.component').then((m) => m.PortalShellComponent),
    canActivate: [roleGuard('PATIENT')],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/patient/dashboard.component').then((m) => m.PatientDashboardComponent),
        title: 'patient.dashboard.title',
      },
      {
        path: 'record',
        loadComponent: () => import('./features/patient/my-record.component').then((m) => m.MyRecordComponent),
        title: 'patient.record.title',
      },
      {
        path: 'appointments',
        loadComponent: () =>
          import('./features/patient/appointments.component').then((m) => m.PatientAppointmentsComponent),
        title: 'patient.appointments.title',
      },
      {
        path: 'request',
        loadComponent: () => import('./features/patient/request.component').then((m) => m.RequestAppointmentComponent),
        title: 'patient.request.title',
      },
      {
        path: 'doctors',
        loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
        title: 'findDoctor.title',
        data: {
          entity: 'doctors',
          icon: 'stethoscope',
          titleKey: 'findDoctor.title',
          ledeKey: 'findDoctor.lede',
        },
      },
      {
        path: 'doctors/:id',
        loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
        title: 'findDoctor.title',
        data: { entity: 'doctors' },
      },
      {
        path: 'library',
        loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
        title: 'library.title',
        data: { entity: 'diseases', icon: 'book', titleKey: 'library.title', ledeKey: 'library.lede' },
      },
      {
        path: 'library/:id',
        loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
        title: 'library.title',
        data: { entity: 'diseases' },
      },
      {
        path: 'hospitals',
        loadComponent: () => import('./features/public/browse.component').then((m) => m.PublicBrowseComponent),
        title: 'directory.title',
        data: { entity: 'hospitals', icon: 'hospital', titleKey: 'directory.title', ledeKey: 'directory.lede' },
      },
      {
        path: 'hospitals/:id',
        loadComponent: () => import('./features/public/detail.component').then((m) => m.PublicDetailComponent),
        title: 'directory.title',
        data: { entity: 'hospitals' },
      },
      {
        path: 'assistant',
        loadComponent: () => import('./features/tools/assistant.component').then((m) => m.AssistantComponent),
        title: 'assistant.title',
        data: { portal: true },
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
        title: 'profile.title',
        data: { crumbKey: 'nav.items.profile' },
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/profile/settings.component').then((m) => m.SettingsComponent),
        title: 'settings.title',
        data: { crumbKey: 'nav.items.settings' },
      },
    ],
  },
  { path: '**', redirectTo: 'error/404' },
];
