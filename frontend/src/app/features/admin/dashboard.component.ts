import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DashboardService } from '../../core/api/insight.service';
import { EntitiesService } from '../../core/api/entity.service';
import type { DashboardData, EntityKey, Individual, Page } from '../../core/api/models';
import { ToastService } from '../../core/toast/toast.service';
import { compact, formatDateTime, relativeTime } from '../../core/util/format';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardActionsDirective, UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiChartComponent } from '../../shared/ui/chart/ui-chart.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiStatCardComponent } from '../../shared/ui/stat-card/ui-stat-card.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { type TableColumn, UiCellDirective, UiTableComponent } from '../../shared/ui/table/ui-table.component';

interface Kpi {
  key: string;
  value: string;
  icon: 'users' | 'stethoscope' | 'calendar-days' | 'flask' | 'database' | 'clock';
  gradient: boolean;
}

/** ADMIN back-office home: every aggregate of the store on one page. */
@Component({
  selector: 'admin-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    RouterLink,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardActionsDirective,
    UiCardComponent,
    UiChartComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
    UiSkeletonComponent,
    UiStatCardComponent,
    UiCellDirective,
    UiTableComponent,
  ],
  template: `
    <div class="page dash">
      <ui-page-header
        tone="hero"
        [title]="'admin.dashboard.title' | translate"
        [subtitle]="subtitle()"
        icon="dashboard"
      >
        <ng-template uiPageActions>
          <ui-button variant="outline" icon="refresh" size="sm" [loading]="loading()" (click)="refresh()">
            {{ 'common.refresh' | translate }}
          </ui-button>
        </ng-template>
      </ui-page-header>

      <section class="actions row" [attr.aria-label]="'common.quickActions' | translate">
        <ui-button variant="secondary" size="sm" icon="plus" (click)="goto('/records/patients?create=1')">
          {{ 'admin.dashboard.actions.newPatient' | translate }}
        </ui-button>
        <ui-button variant="secondary" size="sm" icon="calendar-check" (click)="goto('/records/appointments?create=1')">
          {{ 'admin.dashboard.actions.newAppointment' | translate }}
        </ui-button>
        <ui-button variant="secondary" size="sm" icon="bot" (click)="goto('/tools/assistant')">
          {{ 'admin.dashboard.actions.askAssistant' | translate }}
        </ui-button>
        <ui-button variant="secondary" size="sm" icon="terminal" (click)="goto('/tools/console')">
          {{ 'admin.dashboard.actions.openConsole' | translate }}
        </ui-button>
      </section>

      @if (loadError()) {
        <ui-error-state
          [title]="'ui.error.title' | translate"
          [message]="'admin.dashboard.error.message' | translate"
          [hint]="'common.retry' | translate"
          (retry)="load()"
        />
      } @else if (!dash()) {
        <div class="skeleton-blocks" aria-busy="true" [attr.aria-label]="'admin.dashboard.loading' | translate">
          <div class="grid-kpi">
            @for (k of kpiSlots; track k) {
              <ui-skeleton height="96px" [radius]="'var(--radius-card)'"></ui-skeleton>
            }
          </div>
          <div class="charts">
            @for (c of chartSlots; track c) {
              <ui-skeleton height="320px" [radius]="'var(--radius-card)'"></ui-skeleton>
            }
          </div>
          <div class="lists">
            <ui-skeleton height="260px" [radius]="'var(--radius-card)'"></ui-skeleton>
            <ui-skeleton height="260px" [radius]="'var(--radius-card)'"></ui-skeleton>
          </div>
        </div>
      } @else {
        @if (emptyStore()) {
          <ui-empty-state
            icon="database"
            [title]="'admin.dashboard.empty.title' | translate"
            [hint]="'admin.dashboard.empty.hint' | translate"
          />
        } @else {
          <section class="grid-kpi" [attr.aria-label]="'admin.dashboard.title' | translate">
            @for (k of kpis(); track k.key) {
              <ui-stat-card
                [value]="k.value"
                [label]="k.key | translate"
                [icon]="k.icon"
                [gradient]="k.gradient"
              />
            }
          </section>

          <section class="charts">
            <ui-card [title]="'admin.dashboard.charts.appointmentsPerMonth' | translate" icon="spline" [pad]="'md'">
              <ui-chart
                type="line"
                [labels]="monthLabels()"
                [data]="monthCounts()"
                height="260px"
                [label]="'admin.dashboard.charts.appointmentsPerMonth' | translate"
              />
            </ui-card>
            <ui-card [title]="'admin.dashboard.charts.patientsByAgeClass' | translate" icon="users">
              <ui-chart
                type="doughnut"
                [labels]="names(ageClasses())"
                [data]="values(ageClasses())"
                height="260px"
                [label]="'admin.dashboard.charts.patientsByAgeClass' | translate"
              />
            </ui-card>
            <ui-card [title]="'admin.dashboard.charts.topDiseases' | translate" icon="heart">
              <ui-chart
                type="bar"
                [labels]="names(topDiseases())"
                [data]="values(topDiseases())"
                height="260px"
                [label]="'admin.dashboard.charts.topDiseases' | translate"
              />
            </ui-card>
            <ui-card [title]="'admin.dashboard.charts.appointmentsByStatus' | translate" icon="calendar-check">
              <ui-chart
                type="doughnut"
                [labels]="names(byStatus())"
                [data]="values(byStatus())"
                height="260px"
                [label]="'admin.dashboard.charts.appointmentsByStatus' | translate"
              />
            </ui-card>
            <ui-card [title]="'admin.dashboard.charts.testsByType' | translate" icon="flask">
              <ui-chart
                type="bar"
                [labels]="names(testsByType())"
                [data]="values(testsByType())"
                height="260px"
                [label]="'admin.dashboard.charts.testsByType' | translate"
              />
            </ui-card>
            <ui-card [title]="'admin.dashboard.charts.doctorsBySpecialty' | translate" icon="stethoscope">
              <ui-chart
                type="bar"
                [labels]="names(specialties())"
                [data]="values(specialties())"
                height="260px"
                [label]="'admin.dashboard.charts.doctorsBySpecialty' | translate"
              />
            </ui-card>
            <ui-card [title]="'admin.dashboard.charts.departmentsByHospital' | translate" icon="hospital">
              <ui-chart
                type="bar"
                [labels]="names(departmentsByHospital())"
                [data]="values(departmentsByHospital())"
                height="260px"
                [label]="'admin.dashboard.charts.departmentsByHospital' | translate"
              />
            </ui-card>
          </section>

          <section class="lists">
            <ui-card [title]="'admin.dashboard.lists.upcoming' | translate" icon="calendar-days" [pad]="'none'">
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/calendar">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'admin.dashboard.lists.viewCalendar' | translate }}
                  </ui-button>
                </a>
              </ng-template>
              @if (upcoming().length === 0) {
                <p class="list-empty text-muted text-sm">{{ 'admin.dashboard.lists.upcomingEmpty' | translate }}</p>
              } @else {
                <ui-table
                  [columns]="upcomingColumns()"
                  [rows]="upcoming()"
                  [trackId]="'id'"
                  [stickyHeader]="false"
                  [dense]="true"
                >
                  <ng-template uiCell="label" let-row="row">
                    <a class="id-link" [routerLink]="['/records/appointments', row.id]">{{ row.label }}</a>
                  </ng-template>
                  <ng-template uiCell="date" let-row="row">
                    <span class="nowrap">{{ dateCell(row.date) }}</span>
                    <span class="when-relative text-muted text-sm">{{ relativeCell(row.date) }}</span>
                  </ng-template>
                  <ng-template uiCell="status" let-row="row">
                    <ui-badge kind="status" [status]="row.status" [label]="row.status"></ui-badge>
                  </ng-template>
                </ui-table>
              }
            </ui-card>

            <ui-card [title]="'admin.dashboard.lists.recentTests' | translate" icon="flask" [pad]="'none'">
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/records/tests">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'admin.dashboard.lists.allTests' | translate }}
                  </ui-button>
                </a>
              </ng-template>
              @if (testsError()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="'common.operationFailed' | translate"
                  (retry)="loadRecentTests()"
                />
              } @else if (testsLoading()) {
                <div class="list-skeleton" aria-busy="true">
                  @for (t of testSlots; track t) {
                    <ui-skeleton height="40px"></ui-skeleton>
                  }
                </div>
              } @else if (recentTests().length === 0) {
                <p class="list-empty text-muted text-sm">{{ 'admin.dashboard.lists.recentTestsEmpty' | translate }}</p>
              } @else {
                <ul class="test-list">
                  @for (test of recentTests(); track test.id) {
                    <li class="test-item">
                      <a class="id-link truncate" [routerLink]="['/records/tests', test.id]">{{ test.label }}</a>
                      <span class="test-type text-muted text-sm nowrap">{{ testType(test) }}</span>
                      <span class="text-muted text-sm nowrap">{{ dateCell(testField(test, 'date')) }}</span>
                    </li>
                  }
                </ul>
              }
            </ui-card>
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .dash {
        display: flex;
        flex-direction: column;
        gap: var(--sp-5);
      }
      .actions {
        justify-content: flex-start;
      }
      .grid-kpi {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      @media (min-width: 1500px) {
        .grid-kpi {
          grid-template-columns: repeat(6, minmax(0, 1fr));
        }
      }
      @media (max-width: 760px) {
        .grid-kpi {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 420px) {
        .grid-kpi {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .charts {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
      }
      .lists {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
      }
      .skeleton-blocks,
      .list-skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .card-link {
        text-decoration: none;
      }
      .list-empty {
        margin: 0;
        padding: var(--sp-4);
      }
      .id-link {
        color: var(--primary);
        border-radius: var(--radius-input);
        transition: color var(--duration) var(--ease);
      }
      .id-link:hover {
        color: var(--primary-hover);
        text-decoration: underline;
      }
      .id-link:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .when-relative {
        margin-inline-start: var(--sp-2);
      }
      .test-list {
        list-style: none;
        margin: 0;
        padding: var(--sp-2) var(--sp-4);
        display: flex;
        flex-direction: column;
      }
      .test-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--sp-3);
        padding-block: var(--sp-2);
        border-bottom: 1px solid var(--border);
        min-width: 0;
      }
      .test-item:last-child {
        border-bottom: 0;
      }
      @media (max-width: 480px) {
        .test-item {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class AdminDashboardComponent {
  private readonly dashboard = inject(DashboardService);
  private readonly entities = inject(EntitiesService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly dash = signal<DashboardData | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly recentTests = signal<Individual[]>([]);
  readonly testsLoading = signal(true);
  readonly testsError = signal(false);

  protected readonly kpiSlots = ['a', 'b', 'c', 'd', 'e', 'f'];
  protected readonly chartSlots = ['a', 'b', 'c'];
  protected readonly testSlots = ['1', '2', '3', '4', '5'];

  readonly subtitle = computed(() => {
    const generatedAt = this.dash()?.generatedAt;
    return generatedAt
      ? this.translate.instant('admin.dashboard.generatedAt', { time: formatDateTime(generatedAt, this.lang()) })
      : null;
  });

  readonly kpis = computed<Kpi[]>(() => {
    const d = this.dash();
    if (!d) return [];
    return [
      { key: 'admin.dashboard.kpi.patients', value: String(d.counts.patients), icon: 'users', gradient: true },
      { key: 'admin.dashboard.kpi.doctors', value: String(d.counts.doctors), icon: 'stethoscope', gradient: true },
      { key: 'admin.dashboard.kpi.appointments', value: String(d.counts.appointments), icon: 'calendar-days', gradient: true },
      { key: 'admin.dashboard.kpi.tests', value: String(d.counts.tests), icon: 'flask', gradient: true },
      { key: 'admin.dashboard.kpi.triples', value: compact(d.totalTriples), icon: 'database', gradient: false },
      { key: 'admin.dashboard.kpi.today', value: String(d.appointmentsToday), icon: 'clock', gradient: false },
    ];
  });

  readonly emptyStore = computed(() => {
    const d = this.dash();
    if (!d) return false;
    return d.totalTriples === 0 && ENTITY_MIN.every((key) => d.counts[key] === 0);
  });

  readonly monthLabels = computed(() => (this.dash()?.appointmentsPerMonth ?? []).map((m) => m.month));
  readonly monthCounts = computed(() => (this.dash()?.appointmentsPerMonth ?? []).map((m) => m.count));
  readonly ageClasses = computed(() => this.dash()?.patientsByAgeClass ?? []);
  readonly topDiseases = computed(() => this.dash()?.topDiseases ?? []);
  readonly byStatus = computed(() => this.dash()?.appointmentsByStatus ?? []);
  readonly testsByType = computed(() => this.dash()?.testsByType ?? []);
  readonly specialties = computed(() => this.dash()?.doctorsBySpecialty ?? []);
  readonly departmentsByHospital = computed(() => this.dash()?.departmentsByHospital ?? []);
  readonly upcoming = computed(() => this.dash()?.upcomingAppointments ?? []);

  readonly upcomingColumns = computed<TableColumn<DashboardData['upcomingAppointments'][number]>[]>(() => [
    { field: 'label', header: this.translate.instant('admin.dashboard.columns.appointment') },
    { field: 'date', header: this.translate.instant('admin.dashboard.columns.when') },
    { field: 'patient', header: this.translate.instant('admin.dashboard.columns.patient') },
    { field: 'department', header: this.translate.instant('admin.dashboard.columns.department') },
    { field: 'status', header: this.translate.instant('admin.dashboard.columns.status') },
  ]);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.dashboard
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.dash.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
    this.loadRecentTests();
  }

  refresh(): void {
    this.dashboard
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.dash.set(data);
          this.loadError.set(false);
          this.toast.success(this.translate.instant('admin.dashboard.refreshed'));
        },
        error: () => this.toast.error(this.translate.instant('ui.error.title')),
      });
  }

  loadRecentTests(): void {
    this.testsLoading.set(true);
    this.testsError.set(false);
    this.entities
      .list('tests', { page: 1, pageSize: 6, sort: 'date', order: 'desc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.recentTests.set(page.items);
          this.testsLoading.set(false);
        },
        error: () => {
          this.testsError.set(true);
          this.testsLoading.set(false);
        },
      });
  }

  goto(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected names(values: { label: string }[]): string[] {
    return values.map((v) => v.label);
  }

  protected values(values: { value: number }[]): number[] {
    return values.map((v) => v.value);
  }

  protected dateCell(value: string | null | undefined): string {
    return formatDateTime(value, this.lang());
  }

  protected relativeCell(value: string): string {
    return relativeTime(value, this.lang());
  }

  protected testField(test: Individual, field: string): string {
    const raw = test.fields[field];
    return raw === null || raw === undefined ? '' : String(raw);
  }

  protected testType(test: Individual): string {
    return test.types.find((t) => !t.endsWith('NamedIndividual')) ?? test.types[0] ?? '';
  }

  private lang(): string {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }
}

const ENTITY_MIN: EntityKey[] = ['patients', 'doctors', 'appointments', 'tests'];
