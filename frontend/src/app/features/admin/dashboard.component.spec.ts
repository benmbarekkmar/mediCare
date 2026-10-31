import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { UiChartComponent } from '../../shared/ui/chart/ui-chart.component';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { DashboardService } from '../../core/api/insight.service';
import { EntitiesService } from '../../core/api/entity.service';
import { ToastService } from '../../core/toast/toast.service';
import type { DashboardData, Individual, Page } from '../../core/api/models';
import { TRANSLATE_TEST_IMPORTS } from '../../shared/ui/translate-testing';
import { AdminDashboardComponent } from './dashboard.component';

const FIXTURE = 'Fixture Hospital';

const DASHBOARD: DashboardData = {
  generatedAt: '2026-10-28T10:00:00.000Z',
  counts: {
    patients: 42,
    doctors: 8,
    diseases: 11,
    symptoms: 9,
    treatments: 6,
    medications: 5,
    tests: 13,
    appointments: 17,
    hospitals: 2,
    departments: 7,
  },
  totalTriples: 4321,
  patientsByAgeClass: [
    { label: 'ChildPatient', value: 4 },
    { label: 'AdultPatient', value: 20 },
    { label: 'ElderlyPatient', value: 18 },
  ],
  chronicShare: { chronic: 10, emergency: 2, total: 42, chronicPct: 24 },
  diseasesByCategory: [{ label: 'ChronicDisease', value: 6 }],
  appointmentsByStatus: [
    { label: 'Confirmed', value: 9 },
    { label: 'Pending', value: 8 },
  ],
  appointmentsByType: [{ label: 'Consultation', value: 12 }],
  doctorsBySpecialty: [{ label: 'Cardiologist', value: 3 }],
  testsByType: [{ label: 'BloodTest', value: 7 }],
  departmentsByHospital: [{ label: FIXTURE, value: 4 }],
  topSymptoms: [{ label: 'Fever', value: 12 }],
  patientsPerDoctor: [{ label: 'Doctor_Salma', value: 9 }],
  topDiseases: [{ label: 'Diabetes', value: 10 }],
  patientsPerHospital: [{ label: FIXTURE, value: 30 }],
  appointmentsToday: 3,
  appointmentsPerMonth: [
    { month: '2026-09', count: 4 },
    { month: '2026-10', count: 6 },
  ],
  upcomingAppointments: [
    {
      id: 'Appointment_005',
      label: 'Appointment 005',
      date: '2026-11-03T09:00:00',
      status: 'Confirmed',
      patient: 'Karim Mejri',
      department: 'Cardiology Department 02',
    },
  ],
  executionMs: 80,
};

const EMPTY_TESTS_PAGE: Page<Individual> = {
  items: [
    {
      id: 'Test_001',
      iri: 'http://example.org/Test_001',
      label: 'Blood count',
      types: ['BloodTest', 'NamedIndividual'],
      fields: { date: '2026-10-20T08:30:00', result: 'Normal' },
      relations: {},
    },
  ],
  page: 1,
  pageSize: 6,
  total: 1,
  totalPages: 1,
  sort: null,
  order: 'desc',
  q: null,
};

@Component({
  selector: 'ui-chart',
  standalone: true,
  template: '',
  inputs: ['type', 'labels', 'data', 'height', 'label'],
})
class StubChartComponent {}

describe('AdminDashboardComponent', () => {
  let dashboardSpy: { get: jasmine.Spy };
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    dashboardSpy = { get: jasmine.createSpy('get').and.returnValue(of(DASHBOARD)) };
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['show', 'success', 'error', 'warning', 'info']);
    TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, AdminDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: dashboardSpy },
        { provide: EntitiesService, useValue: { list: () => of(EMPTY_TESTS_PAGE) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.overrideComponent(AdminDashboardComponent, {
      remove: { imports: [UiChartComponent] },
      add: { imports: [StubChartComponent] },
    });
    TestBed.inject(TranslateService).use('en');
  });

  it('renders the KPI values from the dashboard payload', () => {
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('42');
    expect(text).toContain('8');
    expect(text).toContain('17');
    expect(text).toContain('13');
    expect(text).toContain('3');
    expect(text).toContain('admin.dashboard.kpi.patients');
  });

  it('lists the upcoming appointment and links it to the record detail', () => {
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Appointment 005');
    const link = fixture.nativeElement.querySelector('a[href*="records/appointments"]');
    expect(link).not.toBeNull();
  });

  it('shows the error state with a retry when the dashboard call fails', () => {
    dashboardSpy.get.and.returnValue(throwError(() => new Error('down')));
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ui.error.title');
  });

  it('routes quick actions to the correct admin pages', () => {
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];

    const clickAction = (key: string): void => {
      const button = buttons.find((item) => item.textContent?.includes(key));
      expect(button).toBeDefined();
      button?.click();
    };

    clickAction('admin.dashboard.actions.newPatient');
    expect(navigate).toHaveBeenCalledWith('/records/patients?create=1');
    clickAction('admin.dashboard.actions.newAppointment');
    expect(navigate).toHaveBeenCalledWith('/records/appointments?create=1');
    clickAction('admin.dashboard.actions.askAssistant');
    expect(navigate).toHaveBeenCalledWith('/tools/assistant');
    clickAction('admin.dashboard.actions.openConsole');
    expect(navigate).toHaveBeenCalledWith('/tools/console');
  });
});
