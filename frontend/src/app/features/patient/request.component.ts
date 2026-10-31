import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EntitiesService, MetaService } from '../../core/api/entity.service';
import type { EntityInput, EntityMeta, Individual, Page, Ref } from '../../core/api/models';
import { ToastService } from '../../core/toast/toast.service';
import { labelOf } from '../../core/util/labels';
import { findClashes, slotOf, timeOf, toDateOnly, type AppointmentSlot, type ClashCandidate } from '../calendar/calendar.utils';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiDateInputComponent } from '../../shared/ui/date/ui-date-input.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiSelectComponent, type SelectOption } from '../../shared/ui/select/ui-select.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiStepperComponent, type UiStep } from '../../shared/ui/stepper/ui-stepper.component';

type PortalLang = 'en' | 'fr';

const EMPTY_PAGE: Page<Individual> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  sort: null,
  order: 'asc',
  q: null,
};

/** A doctor candidate with the display fields the picker shows. */
interface DoctorOption {
  readonly id: string;
  readonly label: string;
  readonly specialty: string | null;
  readonly departmentId: string | null;
  readonly departmentLabel: string;
  readonly hospitalLabel: string | null;
}

/** One generated time slot for the chosen day. */
interface TimeSlot {
  readonly key: string;
  readonly label: string;
  readonly minutes: number;
  readonly disabled: boolean;
}

/** How many slots the clinic offers per day and at what hours. */
const OPEN_FROM = 8;
const OPEN_TO = 17;
const SLOT_STEP = 30;

/** The weekday grid a doctor can be reached on, best-effort clinic opening. */
const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * The four-step appointment wizard: department -> doctor -> date & time ->
 * review. The visible step count comes from the ontology metadata, and every
 * read the API exposes is honoured, so nothing here hard-codes a field a
 * patient may not write. A patient may only ever book their own visit; the
 * payload carries no status and no clinical field, and the back office always
 * confirms the request before it becomes a real appointment.
 */
@Component({
  selector: 'app-patient-request',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiDateInputComponent,
    UiEmptyStateComponent,
    UiIconComponent,
    UiPageHeaderComponent,
    UiSelectComponent,
    UiSkeletonComponent,
    UiStepperComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page request-page">
      <ui-page-header
      [title]="'patient.request.title' | translate"
      [subtitle]="'patient.request.subtitle' | translate"
      icon="calendar-check"
      back="/patient/appointments"
    />

    @if (submitted()) {
      <ui-card [title]="'patient.request.successTitle' | translate" elevated>
        <div class="ok">
          <span class="ok__icon" aria-hidden="true"><ui-icon name="circle-check" [size]="28" /></span>
          <p class="ok__ref">
            {{ 'patient.request.referenceLabel' | translate }}
            <strong class="mono">{{ createdLabel() }}</strong>
          </p>
          <p class="ok__note">{{ 'patient.request.pendingNote' | translate }}</p>
          <div class="ok__facts">
            <div class="fact">
              <ui-icon name="calendar" [size]="15" />
              <span>{{ whenLabel() }}</span>
            </div>
            <div class="fact">
              <ui-icon name="building" [size]="15" />
              <span>{{ departmentLabel() }}</span>
            </div>
            @if (doctorLabel(); as doctor) {
              <div class="fact">
                <ui-icon name="stethoscope" [size]="15" />
                <span>{{ doctor }}</span>
              </div>
            }
          </div>
          <div class="ok__actions">
            <a routerLink="/patient/appointments" class="btn btn--primary">
              <ui-icon name="list-checks" [size]="15" />
              <span>{{ 'patient.request.seeAppointments' | translate }}</span>
            </a>
            <ui-button variant="outline" icon="plus" (click)="restart()">
              {{ 'patient.request.bookAnother' | translate }}
            </ui-button>
          </div>
        </div>
      </ui-card>
    } @else {
      <ui-stepper
        [steps]="steps()"
        [(index)]="step"
        [completed]="completedFlags()"
        (next)="onNext()"
        (back)="onBack()"
        (finish)="submit()"
      >
        @if (step() === 0) {
          <div class="panel">
            <p class="panel__hint">{{ 'patient.request.chooseDepartment' | translate }}</p>

            @if (loadingDepartments()) {
              <div class="sk-lines">
                @for (row of rows(4); track row) {
                  <ui-skeleton width="100%" height="56px" [radius]="'var(--radius)'" />
                }
              </div>
            } @else if (departments().length === 0) {
              <ui-empty-state icon="building" [title]="'patient.request.noDepartments' | translate" />
            } @else {
              <div class="grid">
                @for (dept of departments(); track dept.id) {
                  <button
                    type="button"
                    class="opt"
                    [class.opt--on]="department()?.id === dept.id"
                    [attr.aria-pressed]="department()?.id === dept.id"
                    (click)="pickDepartment(dept)"
                  >
                    <span class="opt__title">{{ dept.label }}</span>
                    @if (hospitalOf(dept); as hospital) {
                      <span class="opt__sub">{{ hospital }}</span>
                    }
                    <span class="opt__tags">
                      @if (isEmergency(dept)) {
                        <ui-badge kind="warning" [label]="'patient.request.emergencyBadge' | translate" />
                      }
                      <ui-badge kind="info" [label]="dept.typeLabel" />
                    </span>
                  </button>
                }
              </div>
            }
          </div>
        } @else if (step() === 1) {
          <div class="panel">
            <p class="panel__hint">{{ 'patient.request.chooseDoctor' | translate }}</p>

            @if (loadingDoctors()) {
              <div class="sk-lines">
                @for (row of rows(3); track row) {
                  <ui-skeleton width="100%" height="64px" [radius]="'var(--radius)'" />
                }
              </div>
            } @else {
              <div class="grid">
                @for (doctor of doctors(); track doctor.id) {
                  <button
                    type="button"
                    class="opt"
                    [class.opt--on]="doctorId() === doctor.id"
                    [attr.aria-pressed]="doctorId() === doctor.id"
                    (click)="doctorId.set(doctor.id)"
                  >
                    <span class="opt__title">{{ doctor.label }}</span>
                    <span class="opt__sub">
                      {{ doctor.departmentLabel }}
                      @if (doctor.hospitalLabel) {
                        <span class="muted">· {{ doctor.hospitalLabel }}</span>
                      }
                    </span>
                    @if (doctor.specialty) {
                      <span class="opt__tags">
                        <ui-badge kind="info" [label]="specialtyLabel(doctor.specialty)" />
                      </span>
                    }
                  </button>
                }
              </div>
              <button type="button" class="link" (click)="doctorId.set(null)">
                {{ 'patient.request.noPreference' | translate }}
              </button>

              @if (departmentIsEmergency()) {
                <p class="note note--warn">
                  <ui-icon name="triangle-alert" [size]="15" />
                  <span>{{ 'patient.request.emergencyNote' | translate }}</span>
                </p>
              }
            }
          </div>
        } @else if (step() === 2) {
          <div class="panel">
            <p class="panel__hint">{{ 'patient.request.chooseTime' | translate }}</p>

            <div class="field">
              <ui-date-input
                [label]="'patient.request.dateLabel' | translate"
                [min]="minDate()"
                [max]="maxDate()"
                [required]="true"
                [ngModel]="dateValue()"
                (ngModelChange)="onDateChange($event)"
              />
            </div>

            @if (errorText()) {
              <div class="error" role="alert">
                <ui-icon name="triangle-alert" [size]="16" />
                <p class="error__text">{{ errorText() }}</p>
              </div>
            }

            @if (dateValue()) {
              @if (closedDay()) {
                <p class="note note--warn">
                  <ui-icon name="clock" [size]="15" />
                  <span>{{ 'patient.request.closedDay' | translate }}</span>
                </p>
              } @else {
                <div class="slots">
                  @for (slot of slots(); track slot.key) {
                    <button
                      type="button"
                      class="slot"
                      [class.slot--on]="timeValue() === slot.key"
                      [disabled]="slot.disabled"
                      [attr.aria-pressed]="timeValue() === slot.key"
                      [attr.title]="slot.disabled ? ('patient.request.slotTaken' | translate) : null"
                      (click)="pickTime(slot)"
                    >
                      {{ slot.label }}
                    </button>
                  }
                </div>
              }
            }
          </div>
        } @else {
          <div class="panel">
            <p class="panel__hint">{{ 'patient.request.review' | translate }}</p>

            <div class="field">
              <ui-select
                [label]="typeFieldLabel()"
                [options]="typeOptions()"
                [required]="true"
                [(ngModel)]="appointmentType"
              />
            </div>

            <dl class="review">
              <div class="review__row">
                <dt>{{ 'patient.request.factDepartment' | translate }}</dt>
                <dd>{{ departmentLabel() }}</dd>
              </div>
              <div class="review__row">
                <dt>{{ 'patient.request.factDoctor' | translate }}</dt>
                <dd>{{ doctorLabel() ?? ('patient.request.noPreferenceShort' | translate) }}</dd>
              </div>
              <div class="review__row">
                <dt>{{ 'patient.request.factWhen' | translate }}</dt>
                <dd>{{ whenLabel() }}</dd>
              </div>
            </dl>

            <p class="note">
              <ui-icon name="info" [size]="15" />
              <span>{{ 'patient.request.receptionNote' | translate }}</span>
            </p>

            @if (errorText()) {
              <div class="error" role="alert">
                <ui-icon name="triangle-alert" [size]="16" />
                <p class="error__text">{{ errorText() }}</p>
              </div>
            }

            @if (submitting()) {
              <div class="sk-lines">
                <ui-skeleton width="100%" height="44px" [radius]="'var(--radius-input)'" />
              </div>
            } @else {
              <div class="actions">
                <ui-button variant="primary" icon="send" [disabled]="!canSubmit()" (click)="submit()">
                  {{ 'patient.request.confirm' | translate }}
                </ui-button>
              </div>
            }
          </div>
        }
      </ui-stepper>
    }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .request-page {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .panel__hint {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .field {
        max-width: 22rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
        gap: var(--sp-3);
      }
      .opt {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        text-align: left;
        min-block-size: 8.5rem;
        padding: var(--sp-4);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: var(--text);
        font: inherit;
        cursor: pointer;
        transition: border-color var(--duration) var(--ease), box-shadow var(--duration) var(--ease);
      }
      .opt:hover {
        border-color: var(--primary);
        box-shadow: var(--shadow-sm);
      }
      .opt:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .opt--on {
        border-color: var(--primary);
        background: var(--primary-soft);
        box-shadow: inset 0 0 0 1px var(--primary);
      }
      .opt__title {
        font-size: var(--fs-base);
        font-weight: 600;
      }
      .opt__sub {
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .muted {
        color: var(--text-subtle);
      }
      .opt__tags {
        display: flex;
        gap: var(--sp-2);
        flex-wrap: wrap;
        margin-block-start: auto;
      }
      .link {
        align-self: flex-start;
        border: 0;
        background: none;
        color: var(--primary);
        font: inherit;
        font-size: var(--fs-sm);
        cursor: pointer;
        text-decoration: underline;
      }
      .note {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        margin: 0;
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: var(--text-muted);
        font-size: var(--fs-sm);
      }
      .note--warn {
        background: var(--warning-50);
        border-color: var(--border);
        color: var(--text);
      }
      .slots {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
        gap: var(--sp-2);
      }
      .slot {
        padding: var(--sp-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        cursor: pointer;
      }
      .slot:hover:not(:disabled) {
        border-color: var(--primary);
      }
      .slot:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .slot--on {
        background: var(--primary-soft);
        border-color: var(--primary);
        color: var(--primary);
        font-weight: 600;
      }
      .slot:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        text-decoration: line-through;
      }
      .review {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        margin: 0;
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .review__row {
        display: flex;
        justify-content: space-between;
        gap: var(--sp-3);
      }
      .review__row dt {
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .review__row dd {
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--text);
        text-align: end;
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .error {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        padding: var(--sp-3);
        background: var(--danger-50);
        border: 1px solid var(--danger-500);
        border-radius: var(--radius);
        color: var(--text);
      }
      .error__text {
        margin: 0;
        font-size: var(--fs-sm);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .sk-lines {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .ok {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .ok__icon {
        display: grid;
        place-items: center;
        inline-size: 48px;
        block-size: 48px;
        border-radius: var(--radius-pill);
        background: var(--success-50);
        color: var(--success-500);
      }
      .ok__ref {
        margin: 0;
        font-size: var(--fs-base);
        color: var(--text-muted);
      }
      .ok__note {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .ok__facts {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
      .fact {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        font-size: var(--fs-sm);
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .ok__actions {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        flex-wrap: wrap;
        margin-block-start: var(--sp-2);
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-4);
        border-radius: var(--radius-input);
        font-size: var(--fs-sm);
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }
      .btn--primary {
        background: var(--primary);
        color: var(--text-inverse);
      }
      .btn--primary:hover {
        background: var(--primary-hover);
      }
      .mono {
        font-family: var(--font-mono);
      }
      @media (max-width: 640px) {
        .request-page {
          gap: var(--sp-3);
        }
        .panel {
          gap: var(--sp-3);
        }
        .field {
          max-width: 100%;
        }
        .review__row {
          flex-direction: column;
          gap: 0;
        }
        .review__row dd {
          text-align: start;
        }
      }
    `,
  ],
})
export class RequestAppointmentComponent implements OnInit {
  private readonly entities = inject(EntitiesService);
  private readonly meta = inject(MetaService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  readonly step = signal(0);

  private readonly appointmentsMeta = signal<EntityMeta | undefined>(undefined);

  readonly departments = signal<Array<Individual & { typeLabel: string; emergency: boolean }>>([]);
  readonly department = signal<Individual | null>(null);
  readonly loadingDepartments = signal(true);

  readonly doctors = signal<DoctorOption[]>([]);
  readonly doctorId = signal<string | null>(null);
  readonly loadingDoctors = signal(false);

  readonly dateValue = signal<string>('');
  readonly timeValue = signal<string | null>(null);

  readonly appointmentType = signal<string | null>(null);

  readonly slots = signal<TimeSlot[]>([]);

  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly createdLabel = signal<string>('');
  readonly errorText = signal<string | null>(null);

  /** The patient's own appointments, used to disable already-booked minutes. */
  private readonly mySlots = signal<AppointmentSlot[]>([]);

  readonly steps = computed<UiStep[]>(() => [
    { id: 'department', label: this.translate.instant('patient.request.stepDepartment') },
    { id: 'doctor', label: this.translate.instant('patient.request.stepDoctor') },
    { id: 'time', label: this.translate.instant('patient.request.stepTime') },
    { id: 'review', label: this.translate.instant('patient.request.stepReview') },
  ]);

  readonly completedFlags = computed<boolean[]>(() => {
    const done = [
      this.department() !== null,
      // doctor is optional, so it is "complete" as soon as a department is set
      true,
      this.dateValue().length > 0 && this.timeValue() !== null,
      this.appointmentType() !== null,
    ];
    return done;
  });

  readonly minDate = computed(() => toDateOnly(new Date()));
  readonly maxDate = computed(() => toDateOnly(new Date(Date.now() + 90 * 86_400_000)));

  readonly closedDay = computed(() => {
    const value = this.dateValue();
    if (value.length === 0) return false;
    const weekday = new Date(`${value}T00:00`).getDay();
    return weekday === 0;
  });

  readonly canSubmit = computed(
    () => this.department() !== null && this.dateValue().length > 0 && this.timeValue() !== null && !this.submitting(),
  );

  ngOnInit(): void {
    this.meta.load().subscribe(() => {
      this.appointmentsMeta.set(this.meta.of('appointments'));
      if (!this.appointmentType()) this.appointmentType.set(this.defaultType());
    });
    this.readOwnAppointments();
    this.readDepartments();
  }

  // --- reads -----------------------------------------------------------------------

  private readOwnAppointments(): void {
    this.entities
      .list('appointments', { pageSize: 100, sort: 'date', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => this.mySlots.set(page.items.map((item) => slotOf(item))));
  }

  private readDepartments(): void {
    this.loadingDepartments.set(true);
    this.entities
      .list('departments', { pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.errorText.set(this.explain(error));
          this.loadingDepartments.set(false);
          return of(EMPTY_PAGE);
        }),
      )
      .subscribe((page) => {
        const rows = page.items.map((item) => ({
          ...item,
          typeLabel: this.typeOf(item) ?? item.label,
          emergency: item.types.includes('EmergencyDepartment'),
        }));
        this.departments.set(rows);
        this.loadingDepartments.set(false);
        this.applyPreset();
      });
  }

  /** Honour `/patient/request?department=<id>` from "book another". */
  private applyPreset(): void {
    const wanted = this.route.snapshot.queryParamMap.get('department');
    if (!wanted) return;
    const match = this.departments().find((dept) => dept.id === wanted);
    if (match) this.pickDepartment(match);
  }

  pickDepartment(dept: Individual): void {
    this.department.set(dept);
    this.doctorId.set(null);
    this.loadDoctorsFor(dept);
  }

  private loadDoctorsFor(dept: Individual): void {
    this.loadingDoctors.set(true);
    this.doctors.set([]);
    const hospital = this.singleRef(dept.relations['hospital'])?.label ?? null;
    this.entities
      .list('doctors', { department: dept.id, pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => {
        this.doctors.set(
          page.items.map((doctor) => ({
            id: doctor.id,
            label: doctor.label,
            specialty: this.typeOf(doctor),
            departmentId: dept.id,
            departmentLabel: dept.label,
            hospitalLabel: hospital,
          })),
        );
        this.loadingDoctors.set(false);
      });
  }

  // --- time slots ------------------------------------------------------------------

  /** Rebuild the availability as soon as a date is picked, before asking for a time. */
  onDateChange(value: string | null): void {
    const day = value ?? '';
    if (day === this.dateValue()) return;
    this.dateValue.set(day);
    this.timeValue.set(null);
    this.errorText.set(null);
    if (day.length === 0 || this.closedDay()) {
      this.slots.set([]);
      return;
    }
    this.rebuildSlots();
  }

  /** Called when the stepper asks to advance: validate the current step first. */
  onNext(): void {
    if (this.step() === 2 && this.dateValue().length > 0 && !this.closedDay()) this.rebuildSlots();
    if (!this.advanceGuard(this.step())) return;
    this.errorText.set(null);
    this.step.update((value) => Math.min(value + 1, this.steps().length - 1));
  }

  onBack(): void {
    this.errorText.set(null);
    this.step.update((value) => Math.max(value - 1, 0));
  }

  private advanceGuard(step: number): boolean {
    if (step === 0 && this.department() === null) {
      this.errorText.set(this.translate.instant('patient.request.errDepartment'));
      return false;
    }
    if (step === 2) {
      if (this.dateValue().length === 0) {
        this.errorText.set(this.translate.instant('patient.request.errDate'));
        return false;
      }
      if (this.closedDay()) {
        this.errorText.set(this.translate.instant('patient.request.closedDay'));
        return false;
      }
      if (this.timeValue() === null) {
        this.errorText.set(this.translate.instant('patient.request.errTime'));
        return false;
      }
    }
    return true;
  }

  private rebuildSlots(): void {
    const day = this.dateValue();
    const departmentId = this.department()?.id ?? null;
    const doctorId = this.doctorId();
    const now = Date.now();
    const list: TimeSlot[] = [];
    for (let minutes = OPEN_FROM * 60; minutes < OPEN_TO * 60; minutes += SLOT_STEP) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const label = `${pad(hour)}:${pad(minute)}`;
      const instant = `${day}T${label}`;
      const past = timeOf(instant) <= now;
      const clash = this.isBusy(instant, departmentId, doctorId);
      list.push({ key: label, label, minutes, disabled: past || clash });
    }
    this.slots.set(list);
    const chosen = this.timeValue();
    if (chosen && !list.some((slot) => slot.key === chosen || slot.disabled)) {
      // keep the choice; otherwise nothing to do
    }
    if (chosen && list.some((slot) => slot.key === chosen && slot.disabled)) this.timeValue.set(null);
  }

  private isBusy(instant: string, departmentId: string | null, doctorId: string | null): boolean {
    const candidate: ClashCandidate = {
      id: null,
      date: instant,
      doctorIds: doctorId ? [doctorId] : [],
      departmentId,
    };
    // appointments never link a doctor, so a clash is same-minute same-department
    return findClashes(candidate, this.mySlots()).length > 0;
  }

  pickTime(slot: TimeSlot): void {
    if (slot.disabled) return;
    this.timeValue.set(slot.key);
    this.errorText.set(null);
  }

  // --- submit ----------------------------------------------------------------------

  submit(): void {
    if (this.submitting()) return;
    // the finish button must re-validate the time step too
    for (let i = 0; i <= this.step(); i += 1) {
      if (!this.advanceGuard(i)) {
        this.step.set(i);
        return;
      }
    }
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.errorText.set(null);
    const body: EntityInput = {
      types: [this.appointmentType() ?? this.defaultType()],
      date: `${this.dateValue()}T${this.timeValue() ?? '09:00'}`,
      relations: { department: [this.department()?.id ?? ''] },
    };
    this.entities.create('appointments', body).subscribe({
      next: (created) => {
        this.submitting.set(false);
        this.createdLabel.set(created.label || created.id);
        this.submitted.set(true);
        this.toast.success(
          this.translate.instant('patient.request.successTitle'),
          this.translate.instant('patient.request.pendingNote'),
        );
      },
      error: (error: HttpErrorResponse) => {
        this.submitting.set(false);
        this.errorText.set(this.explain(error));
        this.toast.fromProblem(error);
      },
    });
  }

  restart(): void {
    this.submitted.set(false);
    this.createdLabel.set('');
    this.step.set(0);
    this.department.set(null);
    this.doctorId.set(null);
    this.dateValue.set('');
    this.timeValue.set(null);
    this.slots.set([]);
    this.appointmentType.set(this.defaultType());
    this.errorText.set(null);
    void this.router.navigate(['/patient/request']);
  }

  // --- labels ----------------------------------------------------------------------

  protected typeFieldLabel(): string {
    return this.translate.instant('patient.request.factType');
  }

  protected typeOptions(): SelectOption[] {
    const facet = this.appointmentsMeta()?.typeFacet;
    const values = facet?.classes ?? ['Consultation', 'FollowUpAppointment', 'EmergencyAppointment'];
    return values
      .filter((value) => !this.needsEmergencyGate(value))
      .map((value) => ({ value, label: this.typeLabel(value) }));
  }

  private needsEmergencyGate(value: string): boolean {
    return value === 'EmergencyAppointment' && !this.departmentIsEmergency();
  }

  private defaultType(): string {
    const facet = this.appointmentsMeta()?.typeFacet;
    const first = facet?.classes?.find((value) => value !== 'EmergencyAppointment') ?? 'Consultation';
    return first;
  }

  protected departmentIsEmergency(): boolean {
    const dept = this.department();
    return dept !== null && dept.types.includes('EmergencyDepartment');
  }

  protected departmentLabel(): string {
    return this.department()?.label ?? this.translate.instant('patient.request.noDepartmentShort');
  }

  protected doctorLabel(): string | null {
    const id = this.doctorId();
    if (!id) return null;
    return this.doctors().find((doctor) => doctor.id === id)?.label ?? null;
  }

  protected hospitalOf(dept: Individual): string | null {
    return this.singleRef(dept.relations['hospital'])?.label ?? null;
  }

  protected isEmergency(dept: Individual): boolean {
    return dept.types.includes('EmergencyDepartment');
  }

  protected whenLabel(): string {
    const day = this.dateValue();
    const time = this.timeValue();
    if (day.length === 0) return this.translate.instant('patient.request.noWhenShort');
    const text = time ? `${day}T${time}` : day;
    return new Intl.DateTimeFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: time ? '2-digit' : undefined,
      minute: time ? '2-digit' : undefined,
    }).format(new Date(text));
  }

  protected specialtyLabel(specialty: string): string {
    return labelOf(this.translate, `patient.request.specialty.${this.slug(specialty)}`, specialty);
  }

  protected typeLabel(type: string): string {
    return labelOf(this.translate, `patient.request.type.${this.slug(type)}`, type);
  }

  private typeOf(item: Individual): string | null {
    return item.types.find((type) => type !== 'NamedIndividual' && !type.endsWith('Department') && type !== 'Doctor' && type !== 'MedicalAppointment') ?? null;
  }

  private singleRef(value: Ref[] | Ref | null | undefined): Ref | null {
    if (value === null || value === undefined) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
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

  private explain(error: HttpErrorResponse): string {
    const status = error.status;
    if (status === 0) return this.translate.instant('patient.request.errorOffline');
    const message =
      error.error && typeof error.error === 'object' && 'message' in error.error
        ? String((error.error as { message?: unknown }).message)
        : '';
    return message.length > 0 ? message : this.translate.instant('patient.request.errorGeneric');
  }

  protected rows(count: number): number[] {
    return Array.from({ length: count }, (_unused, index) => index);
  }

  /** Exposed so the review step can re-run slot building after a type change. */
  protected refreshSlots(): void {
    this.rebuildSlots();
  }
}
