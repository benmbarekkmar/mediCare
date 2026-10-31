import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EntitiesService } from '../../core/api/entity.service';
import type { Individual, Page, Ref } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/toast/toast.service';
import { downloadCsv } from '../../core/util/csv';
import { formatDate, formatDateTime } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiTabsComponent, type UiTab } from '../../shared/ui/tabs/ui-tabs.component';
import { UiTimelineComponent, type TimelineItem } from '../../shared/ui/timeline/ui-timeline.component';

type PortalLang = 'en' | 'fr';
type RecordTab = 'overview' | 'conditions' | 'tests' | 'visits' | 'timeline';

const EMPTY_PAGE: Page<Individual> = {
  items: [],
  page: 1,
  pageSize: 100,
  total: 0,
  totalPages: 1,
  sort: null,
  order: 'asc',
  q: null,
};

/** One condition with the treatments and medications the knowledge base links to it. */
interface ConditionRecord {
  id: string;
  label: string;
  description: string | null;
  category: string | null;
  symptoms: Ref[];
  treatments: TreatmentRecord[];
}

interface TreatmentRecord {
  id: string;
  label: string;
  type: string | null;
  duration: string | null;
  medications: MedicationRecord[];
}

interface MedicationRecord {
  id: string;
  label: string;
  dosage: string | null;
  drugClass: string | null;
}

/**
 * The printable medical record: the patient's own conditions, their treatments and
 * medications, their results, their visits and one timeline of the whole history.
 *
 * The printable area is a plain `.printable` block with a `.print-header`, so the
 * global print stylesheet in `src/styles/_print.scss` strips the shell, the tabs
 * and every action button, and the paper only ever carries clinical content.
 */
@Component({
  selector: 'app-my-record',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiEmptyStateComponent,
    UiIconComponent,
    UiSkeletonComponent,
    UiTabsComponent,
    UiTimelineComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page record">
      <header class="record__head no-print">
        <div class="record__titles">
          <p class="record__eyebrow">{{ 'patient.record.eyebrow' | translate }}</p>
          <h1 class="record__title">{{ 'patient.record.title' | translate }}</h1>
          <p class="record__lede">{{ 'patient.record.lede' | translate }}</p>
        </div>
        @if (hasLinkedPatient()) {
          <div class="record__tools">
            <ui-button icon="printer" (click)="print()">{{ 'patient.record.print' | translate }}</ui-button>
            <ui-button variant="outline" icon="download" [disabled]="busy()" (click)="downloadSummary()">
              {{ 'patient.record.download' | translate }}
            </ui-button>
            <ui-button variant="ghost" icon="refresh" [disabled]="busy()" (click)="load()">
              {{ 'common.retry' | translate }}
            </ui-button>
          </div>
        }
      </header>

      @if (!hasLinkedPatient()) {
        <ui-card class="no-print" elevated>
          <ui-empty-state
            icon="file-text"
            [title]="'patient.record.noPatientTitle' | translate"
            [hint]="'patient.record.noPatientHint' | translate"
          >
            <p class="support">{{ 'patient.record.noPatientSupport' | translate }}</p>
            <a class="support__link" [routerLink]="assistantPath">{{ 'patient.record.noPatientAssistant' | translate }}</a>
          </ui-empty-state>
        </ui-card>
      } @else {
        @if (loadError()) {
          <div class="banner banner--error no-print" role="alert">
            <ui-icon name="triangle-alert" size="18" />
            <div class="banner__text">
              <p class="banner__title">{{ 'patient.record.loadFailed' | translate }}</p>
              <p class="banner__detail">{{ loadError() }}</p>
            </div>
            <ui-button variant="outline" size="sm" icon="refresh" (click)="load()">
              {{ 'common.retry' | translate }}
            </ui-button>
          </div>
        }

        <div class="no-print">
          <ui-tabs [tabs]="tabs()" [active]="activeTab()" (activeChange)="onTabChange($event)" />
        </div>

        @if (busy()) {
          <div class="stack no-print">
            @for (row of rows(3); track row) {
              <ui-skeleton height="6rem" radius="var(--radius-card)" />
            }
          </div>
        } @else {
          <div class="printable">
            <div class="print-header">
              <div>
                <h2 class="print-header__title">{{ 'patient.record.title' | translate }}</h2>
                <p class="print-header__meta">{{ patientName() }} · {{ patientId() ?? '' }}</p>
              </div>
              <p class="print-header__meta">{{ printedOn() }}</p>
            </div>

            <section class="sheet" [class.sheet--off]="activeTab() !== 'overview'">
              <h2 class="sheet__title">{{ tabs()[0].label }}</h2>
              <div class="facts">
                @for (fact of identityFacts(); track fact.label) {
                  <div class="fact">
                    <p class="fact__label">{{ fact.label }}</p>
                    <p class="fact__value">{{ fact.value }}</p>
                  </div>
                }
              </div>
              @if (careFacts().length > 0) {
                <h3 class="sheet__subtitle">{{ 'patient.record.careTeam' | translate }}</h3>
                <ul class="plain">
                  @for (doctor of doctors(); track doctor.id) {
                    <li class="plain__row">
                      <span class="plain__main">{{ doctor.label }}</span>
                      <span class="plain__meta">{{ specialtyLabel(doctor) }} · {{ departmentLabel(doctor) }}</span>
                    </li>
                  }
                </ul>
              }
              @if (followedIn().length > 0) {
                <h3 class="sheet__subtitle">{{ 'patient.record.followedIn' | translate }}</h3>
                <ul class="plain">
                  @for (place of followedIn(); track place) {
                    <li class="plain__row">{{ place }}</li>
                  }
                </ul>
              }
              @if (careFacts().length === 0) {
                <p class="empty">{{ 'patient.record.overviewEmpty' | translate }}</p>
              }
            </section>

            <section class="sheet" [class.sheet--off]="activeTab() !== 'conditions'">
              <h2 class="sheet__title">{{ tabs()[1].label }}</h2>
              @if (conditions().length === 0) {
                <p class="empty">{{ 'patient.record.conditionsEmpty' | translate }}</p>
              } @else {
                <ul class="conds">
                  @for (condition of conditions(); track condition.id) {
                    <li class="cond">
                      <div class="cond__head">
                        <h3 class="cond__title">{{ condition.label }}</h3>
                        @if (condition.category) {
                          <ui-badge kind="neutral" [label]="categoryLabel(condition.category)" />
                        }
                      </div>
                      @if (condition.description) {
                        <p class="cond__desc">{{ condition.description }}</p>
                      }
                      <p class="cond__link">
                        <a [routerLink]="libraryPath" [queryParams]="{ q: condition.label, family: 'diseases' }">
                          {{ 'patient.record.openInLibrary' | translate }}
                        </a>
                      </p>

                      @if (condition.symptoms.length > 0) {
                        <h4 class="block__label">{{ 'patient.record.symptoms' | translate }}</h4>
                        <ul class="tags">
                          @for (symptom of condition.symptoms; track symptom.id) {
                            <li class="tag">{{ symptom.label }}</li>
                          }
                        </ul>
                      }

                      @if (condition.treatments.length > 0) {
                        <h4 class="block__label">{{ 'patient.record.treatments' | translate }}</h4>
                        <ul class="treats">
                          @for (treatment of condition.treatments; track treatment.id) {
                            <li class="treat">
                              <div class="treat__head">
                                <span class="treat__name">{{ treatment.label }}</span>
                                @if (treatment.type) {
                                  <ui-badge kind="info" [label]="treatmentTypeLabel(treatment.type)" />
                                }
                              </div>
                              <p class="treat__duration">
                                {{ 'patient.record.duration' | translate: { value: durationLabel(treatment) } }}
                              </p>
                              @if (treatment.medications.length > 0) {
                                <ul class="meds">
                                  @for (medication of treatment.medications; track medication.id) {
                                    <li class="med">
                                      <ui-icon name="pill" size="14" />
                                      <span class="med__name">{{ medication.label }}</span>
                                      <span class="med__dosage">{{ dosageLabel(medication) }}</span>
                                    </li>
                                  }
                                </ul>
                              } @else {
                                <p class="empty empty--sm">{{ 'patient.record.noMedications' | translate }}</p>
                              }
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="empty empty--sm">{{ 'patient.record.noTreatments' | translate }}</p>
                      }
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="sheet" [class.sheet--off]="activeTab() !== 'tests'">
              <h2 class="sheet__title">{{ tabs()[2].label }}</h2>
              @if (tests().length === 0) {
                <p class="empty">{{ 'patient.record.testsEmpty' | translate }}</p>
              } @else {
                <ul class="rows">
                  @for (test of tests(); track test.id) {
                    <li class="row-item">
                      <div class="row-item__main">
                        <p class="row-item__title">{{ test.label }}</p>
                        <p class="row-item__meta">{{ resultOf(test) }}</p>
                      </div>
                      <div class="row-item__side">
                        <ui-badge kind="info" [label]="testTypeLabel(test)" />
                        <span class="row-item__date">{{ dateTimeOf(test.fields['date']) }}</span>
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="sheet" [class.sheet--off]="activeTab() !== 'visits'">
              <h2 class="sheet__title">{{ tabs()[3].label }}</h2>
              @if (appointments().length === 0) {
                <p class="empty">{{ 'patient.record.visitsEmpty' | translate }}</p>
              } @else {
                <ul class="rows">
                  @for (visit of appointments(); track visit.id) {
                    <li class="row-item">
                      <div class="row-item__main">
                        <p class="row-item__title">{{ departmentRef(visit) }}</p>
                        <p class="row-item__meta">{{ visit.label }}</p>
                      </div>
                      <div class="row-item__side">
                        <ui-badge kind="status" [status]="statusOf(visit)" [label]="statusLabel(statusOf(visit))" />
                        <span class="row-item__date">{{ dateTimeOf(visit.fields['date']) }}</span>
                      </div>
                    </li>
                  }
                </ul>
                <p class="hint">{{ 'patient.record.visitsHint' | translate }}</p>
              }
            </section>

            <section class="sheet" [class.sheet--off]="activeTab() !== 'timeline'">
              <h2 class="sheet__title">{{ tabs()[4].label }}</h2>
              <ui-timeline [items]="timeline()" />
            </section>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .record {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .record__head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--sp-4);
        flex-wrap: wrap;
      }
      .record__eyebrow {
        margin: 0 0 var(--sp-1);
        font-size: var(--fs-sm);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--secondary);
      }
      .record__title {
        margin: 0;
        font-size: var(--fs-2xl);
      }
      .record__lede {
        margin: var(--sp-2) 0 0;
        max-width: 62ch;
        font-size: var(--fs-md);
        color: var(--text-muted);
      }
      .record__tools {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .printable {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .print-header {
        display: none;
        gap: var(--sp-3);
      }
      .print-header__title {
        margin: 0;
        font-size: var(--fs-lg);
      }
      .print-header__meta {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .sheet {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
        padding: var(--sp-5);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-sm);
      }
      .sheet--off {
        display: none;
      }
      .sheet__title {
        margin: 0;
        font-size: var(--fs-xl);
      }
      .sheet__subtitle {
        margin: var(--sp-4) 0 var(--sp-2);
        font-size: var(--fs-md);
        color: var(--text-muted);
      }
      .block__label {
        margin: var(--sp-3) 0 var(--sp-1);
        font-size: var(--fs-sm);
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--secondary);
      }
      .facts {
        display: grid;
        gap: var(--sp-3);
        grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
      }
      .fact {
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .fact__label {
        margin: 0;
        font-size: var(--fs-xs);
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-subtle);
      }
      .fact__value {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-md);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .plain {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .plain__row {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        font-size: var(--fs-md);
      }
      .plain__main {
        font-weight: 600;
      }
      .plain__meta {
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .conds {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .cond {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding: var(--sp-4);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-inline-start: 4px solid var(--secondary);
        border-radius: var(--radius-card);
      }
      .cond__head {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
      }
      .cond__title {
        margin: 0;
        font-size: var(--fs-lg);
      }
      .cond__desc {
        margin: 0;
        font-size: var(--fs-md);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .cond__link {
        margin: 0;
        font-size: var(--fs-sm);
      }
      .tags {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .tag {
        padding: var(--sp-1) var(--sp-3);
        font-size: var(--fs-sm);
        background: var(--primary-soft);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
      }
      .treats,
      .meds,
      .rows {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .treat {
        padding: var(--sp-3);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .treat__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
        flex-wrap: wrap;
      }
      .treat__name {
        font-size: var(--fs-md);
        font-weight: 650;
      }
      .treat__duration {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .meds {
        margin-block-start: var(--sp-2);
        gap: var(--sp-1);
      }
      .med {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        font-size: var(--fs-sm);
      }
      .med ui-icon {
        color: var(--accent);
        flex: none;
      }
      .med__name {
        font-weight: 600;
      }
      .med__dosage {
        color: var(--text-muted);
      }
      .row-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sp-3);
        flex-wrap: wrap;
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .row-item__main {
        flex: 1 1 220px;
        min-width: 0;
      }
      .row-item__title {
        margin: 0;
        font-size: var(--fs-md);
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .row-item__meta {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .row-item__side {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--sp-1);
      }
      .row-item__date {
        font-size: var(--fs-sm);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .empty,
      .hint {
        margin: 0;
        font-size: var(--fs-md);
        color: var(--text-muted);
      }
      .empty--sm {
        font-size: var(--fs-sm);
      }
      .support {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .support__link {
        display: inline-block;
        margin-block-start: var(--sp-2);
        font-size: var(--fs-sm);
        font-weight: 600;
      }
      .banner {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-3);
        padding: var(--sp-4);
        background: var(--danger-50);
        border: 1px solid var(--danger-100);
        border-radius: var(--radius-card);
      }
      .banner__text {
        flex: 1 1 240px;
        min-width: 0;
      }
      .banner__title {
        margin: 0;
        font-size: var(--fs-md);
        font-weight: 650;
      }
      .banner__detail {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }

      /* the paper keeps every section, the screen only keeps the open tab */
      @media print {
        .sheet--off {
          display: flex !important;
        }
        .sheet {
          border: 1px solid var(--border);
          box-shadow: none;
          break-inside: avoid;
        }
        .record__tools,
        .banner {
          display: none !important;
        }
      }

      @media (max-width: 640px) {
        .sheet {
          padding: var(--sp-4);
        }
        .row-item__side {
          flex-direction: row;
          align-items: center;
        }
      }
    `,
  ],
})
export class MyRecordComponent implements OnInit {
  readonly assistantPath = '/patient/assistant';
  readonly libraryPath = '/patient/library';

  private readonly entities = inject(EntitiesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  readonly profile = signal<Individual | null>(null);
  readonly doctors = signal<Individual[]>([]);
  readonly conditions = signal<ConditionRecord[]>([]);
  readonly tests = signal<Individual[]>([]);
  readonly appointments = signal<Individual[]>([]);

  readonly loadingProfile = signal(false);
  readonly loadingTests = signal(false);
  readonly loadingVisits = signal(false);
  readonly loadingConditions = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly activeTab = signal<RecordTab>('overview');

  readonly patientId = computed<string | null>(() => this.auth.user()?.linkedId ?? null);
  readonly hasLinkedPatient = computed<boolean>(() => this.patientId() !== null);
  readonly busy = computed<boolean>(
    () => this.loadingProfile() || this.loadingTests() || this.loadingVisits() || this.loadingConditions(),
  );

  readonly tabs = computed<UiTab[]>(() => [
    { id: 'overview', label: this.translate.instant('patient.record.tabOverview'), icon: 'user' },
    { id: 'conditions', label: this.translate.instant('patient.record.tabConditions'), icon: 'heart' },
    { id: 'tests', label: this.translate.instant('patient.record.tabTests'), icon: 'flask' },
    { id: 'visits', label: this.translate.instant('patient.record.tabVisits'), icon: 'calendar' },
    {
      id: 'timeline',
      label: this.translate.instant('patient.record.tabTimeline'),
      icon: 'waypoints',
      badge: this.timeline().length,
    },
  ]);

  readonly careFacts = computed<Individual[]>(() => this.doctors());

  readonly timeline = computed<TimelineItem[]>(() => {
    const unknownDate = this.translate.instant('patient.shared.noDate');
    const visits: TimelineItem[] = this.appointments().map((visit) => ({
      id: `visit-${visit.id}`,
      title: this.departmentRef(visit),
      date: this.rawDate(visit),
      kind: 'appointment',
      detail: `${this.statusLabel(this.statusOf(visit))} · ${visit.label}`,
    }));
    const tests: TimelineItem[] = this.tests().map((test) => ({
      id: `test-${test.id}`,
      title: test.label,
      date: this.dateValue(test),
      kind: 'test',
      detail: this.resultOf(test),
    }));
    const conditions: TimelineItem[] = this.conditions().map((condition) => ({
      id: `cond-${condition.id}`,
      title: condition.label,
      date: unknownDate,
      kind: 'diagnosis',
      detail:
        condition.symptoms.length > 0
          ? condition.symptoms.map((symptom) => symptom.label).join(', ')
          : this.translate.instant('patient.record.symptomsUnknown'),
      link: `${this.libraryPath}?q=${encodeURIComponent(condition.label)}&family=diseases`,
    }));
    return [...visits, ...tests, ...conditions];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const id = this.patientId();
    this.loadError.set(null);
    if (!id) return;
    this.loadingProfile.set(true);
    this.entities.get('patients', id).subscribe({
      next: (patient) => {
        this.profile.set(patient);
        this.loadingProfile.set(false);
        this.loadHistory(id);
        this.loadClinicalView();
      },
      error: (error: HttpErrorResponse) => {
        this.loadingProfile.set(false);
        this.fail(error);
      },
    });
  }

  // --- reads -------------------------------------------------------------------

  /** Conditions, results and visits: three calls, all scoped to this patient. */
  private loadHistory(id: string): void {
    this.loadingTests.set(true);
    this.entities
      .list('tests', { pageSize: 100, sort: 'date', order: 'desc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => {
        this.tests.set(page.items);
        this.loadingTests.set(false);
      });

    this.loadingVisits.set(true);
    this.entities
      .list('appointments', { pageSize: 100, sort: 'date', order: 'desc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => {
        this.appointments.set(page.items);
        this.loadingVisits.set(false);
      });

    this.entities
      .list('doctors', { patient: id, pageSize: 50, sort: 'label', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => this.doctors.set(page.items));
  }

  /**
   * The clinical tree is knowledge, not personal data: one page of conditions of
   * this patient, plus the whole treatment and medication catalogues, joined here
   * so the record needs three requests instead of one per condition.
   */
  private loadClinicalView(): void {
    this.loadingConditions.set(true);
    const id = this.patientId();
    if (!id) {
      this.loadingConditions.set(false);
      return;
    }
    this.entities
      .list('diseases', { patient: id, pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(
        catchError(() => of(EMPTY_PAGE)),
      )
      .subscribe({
        next: (diseases) => {
          this.conditions.set(
            diseases.items.map((disease) => ({
              id: disease.id,
              label: disease.label,
              description: this.textOf(disease, 'description'),
              category: disease.types.find((type) => type.endsWith('Disease')) ?? null,
              symptoms: this.refsOf(disease.relations['symptoms']),
              treatments: [],
            })),
          );
          this.linkTreatments();
          this.loadingConditions.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.loadingConditions.set(false);
          this.fail(error);
        },
      });
  }

  private linkTreatments(): void {
    const conditionIds = new Set(this.conditions().map((row) => row.id));
    this.entities
      .list('treatments', { pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((treatments) => {
        this.entities
          .list('medications', { pageSize: 100, sort: 'label', order: 'asc' })
          .pipe(catchError(() => of(EMPTY_PAGE)))
          .subscribe((medications) => {
            const medicationById = new Map(medications.items.map((item) => [item.id, item]));
            const byCondition = new Map<string, TreatmentRecord[]>();
            for (const treatment of treatments.items) {
              const record: TreatmentRecord = {
                id: treatment.id,
                label: treatment.label,
                type: this.facetOf(treatment, 'Treatment'),
                duration: this.textOf(treatment, 'duration'),
                medications: this.refsOf(treatment.relations['medications'])
                  .map((ref) => medicationById.get(ref.id))
                  .filter((item): item is Individual => item !== undefined)
                  .map((item) => ({
                    id: item.id,
                    label: item.label,
                    dosage: this.textOf(item, 'dosage'),
                    drugClass: this.facetOf(item, 'Medication'),
                  })),
              };
              for (const diseaseId of this.refsOf(treatment.relations['diseases'])) {
                if (!conditionIds.has(diseaseId.id)) continue;
                const bucket = byCondition.get(diseaseId.id);
                if (bucket) bucket.push(record);
                else byCondition.set(diseaseId.id, [record]);
              }
            }
            this.conditions.update((rows) =>
              rows.map((row) => ({
                ...row,
                treatments: (byCondition.get(row.id) ?? []).slice(0, 12),
              })),
            );
          });
      });
  }

  // --- printing and export -------------------------------------------------------

  print(): void {
    window.print();
  }

  /** A flat one-row-per-fact CSV: readable in any spreadsheet, no clinical jargon added. */
  downloadSummary(): void {
    const id = this.patientId();
    if (!id) return;
    const rows: Record<string, unknown>[] = [];
    const language = this.lang();

    for (const fact of this.identityFacts()) rows.push({ section: 'identity', date: '', name: fact.label, detail: fact.value });
    for (const doctor of this.doctors()) {
      rows.push({
        section: 'doctor',
        date: '',
        name: doctor.label,
        detail: `${this.specialtyLabel(doctor)} · ${this.departmentLabel(doctor)}`,
      });
    }
    for (const condition of this.conditions()) {
      rows.push({
        section: 'condition',
        date: '',
        name: condition.label,
        detail: condition.category ? this.categoryLabel(condition.category) : '',
      });
      for (const symptom of condition.symptoms) {
        rows.push({ section: 'symptom', date: '', name: condition.label, detail: symptom.label });
      }
      for (const treatment of condition.treatments) {
        rows.push({
          section: 'treatment',
          date: '',
          name: `${condition.label} · ${treatment.label}`,
          detail: this.durationLabel(treatment),
        });
        for (const medication of treatment.medications) {
          rows.push({
            section: 'medication',
            date: '',
            name: `${treatment.label} · ${medication.label}`,
            detail: this.dosageLabel(medication),
          });
        }
      }
    }
    for (const test of this.tests()) {
      rows.push({
        section: 'test',
        date: formatDate(this.dateValue(test), language),
        name: test.label,
        detail: `${this.testTypeLabel(test)} · ${this.resultOf(test)}`,
      });
    }
    for (const visit of this.appointments()) {
      rows.push({
        section: 'visit',
        date: this.dateTimeOf(visit.fields['date']),
        name: this.departmentRef(visit),
        detail: this.statusLabel(this.statusOf(visit)),
      });
    }

    downloadCsv(`medicare-record-${id}`, ['section', 'date', 'name', 'detail'], rows);
    this.toast.success(
      this.translate.instant('patient.record.downloadDoneTitle'),
      this.translate.instant('patient.record.downloadDoneBody'),
    );
  }

  // --- view helpers ---------------------------------------------------------------

  protected onTabChange(id: string): void {
    const known: RecordTab[] = ['overview', 'conditions', 'tests', 'visits', 'timeline'];
    this.activeTab.set(known.includes(id as RecordTab) ? (id as RecordTab) : 'overview');
  }

  protected rows(count: number): number[] {
    return Array.from({ length: count }, (_unused, index) => index);
  }

  protected identityFacts(): { label: string; value: string }[] {
    const patient = this.profile();
    if (!patient) return [];
    const facts = [{ label: this.translate.instant('patient.record.fieldName'), value: patient.label }];
    const age = patient.fields['age'];
    if (age !== null && age !== undefined) {
      facts.push({
        label: this.translate.instant('patient.record.fieldAge'),
        value: this.translate.instant('patient.record.fieldAgeValue', { value: age }),
      });
    }
    const gender = this.textOf(patient, 'gender');
    if (gender) facts.push({ label: this.translate.instant('patient.record.fieldGender'), value: this.genderLabel(gender) });
    const blood = this.textOf(patient, 'bloodType');
    if (blood) facts.push({ label: this.translate.instant('patient.record.fieldBlood'), value: blood });
    const phone = this.textOf(patient, 'phone');
    if (phone) facts.push({ label: this.translate.instant('patient.record.fieldPhone'), value: phone });
    return facts;
  }

  protected followedIn(): string[] {
    const places = new Set<string>();
    for (const doctor of this.doctors()) {
      const department = this.singleRef(doctor.relations['department']);
      if (department) places.add(`${department.label}`);
    }
    const hospital = this.singleRef(this.profile()?.relations['hospital']);
    if (hospital) places.add(hospital.label);
    return [...places];
  }

  protected patientName(): string {
    return this.profile()?.label ?? this.auth.user()?.fullName ?? '';
  }

  protected printedOn(): string {
    return `${this.translate.instant('patient.record.printedOn')} ${formatDateTime(new Date().toISOString(), this.lang())}`;
  }

  protected statusOf(item: Individual): string {
    return this.textOf(item, 'status') ?? '';
  }

  protected departmentRef(item: Individual): string {
    return this.singleRef(item.relations['department'])?.label ?? this.translate.instant('patient.record.noDepartment');
  }

  protected specialtyLabel(doctor: Individual): string {
    const specialty = doctor.types.find((type) => type !== 'Doctor' && type !== 'NamedIndividual') ?? '';
    return labelOf(this.translate, `patient.shared.specialty.${this.slug(specialty)}`, specialty);
  }

  protected departmentLabel(doctor: Individual): string {
    return (
      this.singleRef(doctor.relations['department'])?.label ?? this.translate.instant('patient.record.noDepartment')
    );
  }

  protected testTypeLabel(test: Individual): string {
    const type = this.facetOf(test, 'MedicalTest') ?? '';
    return labelOf(this.translate, `patient.shared.testType.${this.slug(type)}`, type || 'Medical test');
  }

  protected categoryLabel(category: string): string {
    return labelOf(this.translate, `patient.shared.diseaseCategory.${this.slug(category)}`, category);
  }

  protected treatmentTypeLabel(type: string): string {
    return labelOf(this.translate, `patient.shared.treatmentType.${this.slug(type)}`, type);
  }

  protected statusLabel(status: string): string {
    return labelOf(this.translate, `patient.shared.status.${this.slug(status)}`, status);
  }

  protected genderLabel(gender: string): string {
    return labelOf(this.translate, `patient.shared.gender.${this.slug(gender)}`, gender);
  }

  protected durationLabel(treatment: { duration: string | null }): string {
    return treatment.duration ?? this.translate.instant('patient.shared.notSet');
  }

  protected dosageLabel(medication: { dosage: string | null }): string {
    return medication.dosage ?? this.translate.instant('patient.shared.notSet');
  }

  protected resultOf(test: Individual): string {
    return this.textOf(test, 'result') ?? this.translate.instant('patient.shared.noResult');
  }

  protected rawDate(item: Individual): string {
    return this.dateValue(item);
  }

  protected dateValue(item: Individual): string {
    return this.textOf(item, 'date') ?? '';
  }

  protected dateTimeOf(raw: string | number | null | undefined): string {
    if (typeof raw !== 'string' || raw.length === 0) return this.translate.instant('patient.shared.noDate');
    return formatDateTime(raw, this.lang());
  }

  private textOf(item: Individual, field: string): string | null {
    const value = item.fields[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private facetOf(item: Individual, ownClass: string): string | null {
    return item.types.find((type) => type !== ownClass && type !== 'NamedIndividual') ?? null;
  }

  private singleRef(value: Ref[] | Ref | null | undefined): Ref | null {
    if (value === null || value === undefined) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  private refsOf(value: Ref[] | Ref | null | undefined): Ref[] {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }

  private slug(value: string): string {
    const cleaned = (value ?? '').trim().toLowerCase().replace(/[^a-z]+/g, '');
    return cleaned.length > 0 ? cleaned : 'unknown';
  }

  private lang(): PortalLang {
    const current = this.translate.currentLang;
    if (current === 'fr' || current === 'en') return current;
    return document.documentElement.lang === 'fr' ? 'fr' : 'en';
  }

  private fail(error: HttpErrorResponse): void {
    this.loadingProfile.set(false);
    this.loadingTests.set(false);
    this.loadingVisits.set(false);
    this.loadingConditions.set(false);
    this.loadError.set(error.message || this.translate.instant('errors.UNKNOWN'));
  }
}
