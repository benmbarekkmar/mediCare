import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EntitiesService } from '../../core/api/entity.service';
import type { EntityInput, Individual, Page, Ref } from '../../core/api/models';
import { ToastService } from '../../core/toast/toast.service';
import { labelOf } from '../../core/util/labels';
import { dayKey, timeOf } from '../calendar/calendar.utils';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';

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

/** A visit reduced to the few fields a card or an agenda cell needs. */
interface Visit {
  readonly id: string;
  readonly iri: string;
  readonly date: string;
  readonly status: string;
  readonly type: string | null;
  readonly departmentId: string | null;
  readonly departmentLabel: string;
  readonly doctorLabel: string | null;
  readonly dayLabel: string;
  readonly timeLabel: string;
}

/** One agenda cell: a day of the month grid with its visits. */
interface AgendaDay {
  readonly key: string;
  readonly date: Date;
  readonly dayNumber: number;
  readonly label: string;
  readonly inMonth: boolean;
  readonly isToday: boolean;
  readonly visits: Visit[];
}

const pad = (value: number): string => String(value).padStart(2, '0');
const dateKey = (value: Date): string => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const firstOfMonth = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), 1, 12);
const addDays = (value: Date, days: number): Date =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, 12);

/**
 * The patient's own appointments: an upcoming/past list and a month-grid agenda
 * built from the very same rows, with no calendar library.
 *
 * Reads go through `/appointments`, which the API already scopes to the signed
 * in patient, and the only write the portal offers is a cancellation that the
 * back office is expected to confirm. Nothing here can touch a clinical field.
 */
@Component({
  selector: 'app-patient-appointments',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiConfirmDialogComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiIconComponent,
    UiPageHeaderComponent,
    UiSkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header
      [title]="'patient.appointments.title' | translate"
      [subtitle]="'patient.appointments.subtitle' | translate"
      icon="calendar"
    >
      <div uiPageActions class="hdr-actions">
        <div class="seg" role="group" [attr.aria-label]="'patient.appointments.viewLabel' | translate">
          <button
            type="button"
            class="seg__btn"
            [class.seg__btn--on]="view() === 'list'"
            [attr.aria-pressed]="view() === 'list'"
            (click)="view.set('list')"
          >
            <ui-icon name="list" [size]="16" />
            <span>{{ 'patient.appointments.list' | translate }}</span>
          </button>
          <button
            type="button"
            class="seg__btn"
            [class.seg__btn--on]="view() === 'agenda'"
            [attr.aria-pressed]="view() === 'agenda'"
            (click)="view.set('agenda')"
          >
            <ui-icon name="calendar-days" [size]="16" />
            <span>{{ 'patient.appointments.agenda' | translate }}</span>
          </button>
        </div>

        <a class="cta" routerLink="/patient/request">
          <ui-icon name="plus" [size]="16" />
          <span>{{ 'patient.appointments.requestCta' | translate }}</span>
        </a>
      </div>
    </ui-page-header>

    @if (loading()) {
      <ui-card [title]="cardTitle()" elevated>
        <div class="stack">
          @for (row of rows(4); track row) {
            <div class="sk-row">
              <ui-skeleton width="64px" height="64px" [radius]="'var(--radius)'" />
              <div class="sk-lines">
                <ui-skeleton width="55%" height="14px" />
                <ui-skeleton width="35%" height="12px" />
                <ui-skeleton width="45%" height="12px" />
              </div>
            </div>
          }
        </div>
      </ui-card>
    } @else if (loadError()) {
      <ui-error-state
        [title]="'patient.appointments.errorTitle' | translate"
        [message]="loadError() ?? ''"
        [hint]="'patient.appointments.errorHint' | translate"
        (retry)="load()"
      />
    } @else if (isEmpty()) {
      <ui-card [title]="cardTitle()" elevated>
        <ui-empty-state icon="calendar" [title]="'patient.appointments.empty' | translate">
          <a routerLink="/patient/request" class="cta">
            <ui-icon name="plus" [size]="16" />
            <span>{{ 'patient.appointments.requestCta' | translate }}</span>
          </a>
        </ui-empty-state>
      </ui-card>
    } @else {
      @if (view() === 'list') {
        @if (upcoming().length > 0) {
          <ui-card [title]="'patient.appointments.upcoming' | translate" elevated>
            <div class="stack">
              @for (visit of upcoming(); track visit.id) {
                <div class="visit">
                  <div class="visit__when">
                    <span class="visit__day">{{ visit.dayLabel }}</span>
                    <span class="visit__time">{{ visit.timeLabel }}</span>
                  </div>
                  <div class="visit__body">
                    <p class="visit__title">
                      {{ typeLabel(visit.type) }}
                      @if (visit.doctorLabel) {
                        <span class="visit__doctor">· {{ visit.doctorLabel }}</span>
                      }
                    </p>
                    <p class="visit__meta">
                      <ui-icon name="building" [size]="14" />
                      <span>{{ visit.departmentLabel }}</span>
                    </p>
                    <ui-badge kind="status" [status]="visit.status" [label]="statusLabel(visit.status)" />
                  </div>
                  <div class="visit__actions">
                    <a class="act" [routerLink]="['/patient/request']" [queryParams]="bookAnother(visit)">
                      <ui-icon name="plus" [size]="14" />
                      <span>{{ 'patient.appointments.bookAnother' | translate }}</span>
                    </a>
                    @if (mayCancel(visit)) {
                      <button type="button" class="act act--danger" (click)="askCancel(visit)">
                        <ui-icon name="x" [size]="14" />
                        <span>{{ 'patient.appointments.cancel' | translate }}</span>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          </ui-card>
        }

        @if (past().length > 0) {
          <ui-card [title]="'patient.appointments.past' | translate" elevated class="mt">
            <div class="stack">
              @for (visit of past(); track visit.id) {
                <div class="visit">
                  <div class="visit__when">
                    <span class="visit__day">{{ visit.dayLabel }}</span>
                    <span class="visit__time">{{ visit.timeLabel }}</span>
                  </div>
                  <div class="visit__body">
                    <p class="visit__title">
                      {{ typeLabel(visit.type) }}
                      @if (visit.doctorLabel) {
                        <span class="visit__doctor">· {{ visit.doctorLabel }}</span>
                      }
                    </p>
                    <p class="visit__meta">
                      <ui-icon name="building" [size]="14" />
                      <span>{{ visit.departmentLabel }}</span>
                    </p>
                    <ui-badge kind="status" [status]="visit.status" [label]="statusLabel(visit.status)" />
                  </div>
                </div>
              }
            </div>
          </ui-card>
        }
      } @else {
        @if (agenda()) {
          <ui-card [title]="agendaTitle()" elevated>
            <div class="agenda">
              <div class="agenda__head">
                <ui-button variant="ghost" size="sm" icon="chevron-left" (click)="prevMonth()">
                  {{ 'patient.appointments.prevMonth' | translate }}
                </ui-button>
                <p class="agenda__month">{{ agenda().title }}</p>
                <ui-button variant="ghost" size="sm" icon-right="chevron-right" (click)="nextMonth()">
                  {{ 'patient.appointments.nextMonth' | translate }}
                </ui-button>
              </div>
              <div class="agenda__grid">
                @for (day of agenda().days; track day.key) {
                  <button
                    type="button"
                    class="cell"
                    [class.cell--out]="!day.inMonth"
                    [class.cell--today]="day.isToday"
                    [class.cell--sel]="selectedDay() === day.key"
                    [attr.aria-label]="day.label"
                    (click)="selectDay(day.key)"
                  >
                    <span class="cell__num">{{ day.dayNumber }}</span>
                    @if (day.visits.length > 0) {
                      <span class="cell__dot" aria-hidden="true"></span>
                    }
                  </button>
                }
              </div>
              @if (agendaDayVisits(); as list) {
                <div class="agenda__day">
                  <p class="agenda__day-title">{{ agenda().selectedLabel }}</p>
                  @if (list.length === 0) {
                    <p class="agenda__none">{{ 'patient.appointments.agendaNoVisits' | translate }}</p>
                  } @else {
                    @for (visit of list; track visit.id) {
                      <div class="agenda__visit">
                        <span class="agenda__visit-time">{{ visit.timeLabel }}</span>
                        <div class="agenda__visit-body">
                          <p class="visit__title">
                            {{ typeLabel(visit.type) }}
                            @if (visit.doctorLabel) {
                              <span class="visit__doctor">· {{ visit.doctorLabel }}</span>
                            }
                          </p>
                          <p class="visit__meta">
                            <ui-icon name="building" [size]="14" />
                            <span>{{ visit.departmentLabel }}</span>
                          </p>
                          <ui-badge kind="status" [status]="visit.status" [label]="statusLabel(visit.status)" />
                        </div>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          </ui-card>
        }
      }
    }

    <ui-confirm-dialog
      [open]="cancelOpen()"
      [title]="'patient.appointments.cancelTitle' | translate"
      [message]="cancelMessage()"
      [confirmLabel]="'patient.appointments.cancelConfirm' | translate"
      [busy]="cancelling()"
      (openChange)="onCancelOpenChange($event)"
      (confirmed)="confirmCancel()"
    />

    @if (cancelBlocked()) {
      <div class="banner" role="status">
        <ui-icon name="info" [size]="16" />
        <p class="banner__text">{{ 'patient.appointments.cancelBlocked' | translate }}</p>
        <ui-button variant="ghost" size="sm" (click)="cancelBlocked.set(false)">
          {{ 'patient.appointments.dismiss' | translate }}
        </ui-button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .hdr-actions {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        flex-wrap: wrap;
      }
      .seg {
        display: inline-flex;
        gap: 2px;
        padding: 3px;
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
      }
      .seg__btn {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        padding: var(--sp-1) var(--sp-3);
        border: 0;
        border-radius: var(--radius-pill);
        background: transparent;
        color: var(--text-muted);
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 600;
        cursor: pointer;
        transition: background var(--duration) var(--ease), color var(--duration) var(--ease);
      }
      .seg__btn:hover {
        color: var(--text);
      }
      .seg__btn--on {
        background: var(--primary-soft);
        color: var(--primary);
      }
      .cta {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-4);
        border-radius: var(--radius-input);
        background: var(--primary);
        color: var(--text-inverse);
        font-size: var(--fs-sm);
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }
      .cta:hover {
        background: var(--primary-hover);
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .mt {
        margin-block-start: var(--sp-5);
      }
      .sk-row {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
      }
      .sk-lines {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .visit {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: var(--sp-4);
        align-items: center;
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .visit__when {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 56px;
        padding: var(--sp-2);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .visit__day {
        font-size: var(--fs-base);
        font-weight: 700;
        color: var(--text);
      }
      .visit__time {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--text-muted);
      }
      .visit__body {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .visit__title {
        margin: 0;
        font-size: var(--fs-base);
        font-weight: 600;
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .visit__doctor {
        font-weight: 400;
        color: var(--text-muted);
      }
      .visit__meta {
        display: flex;
        align-items: center;
        gap: var(--sp-1);
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .visit__actions {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--sp-2);
      }
      .act {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sp-1);
        padding: var(--sp-1) var(--sp-3);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-input);
        background: var(--surface);
        color: var(--primary);
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
      }
      .act:hover {
        background: var(--primary-soft);
        border-color: var(--primary);
      }
      .act--danger {
        color: var(--danger-700);
      }
      .act--danger:hover {
        background: var(--danger-50);
        border-color: var(--danger-500);
      }
      .agenda {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .agenda__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
      }
      .agenda__month {
        margin: 0;
        font-size: var(--fs-md);
        font-weight: 600;
        color: var(--text);
        text-align: center;
        min-width: 0;
        flex: 1;
      }
      .agenda__grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: var(--sp-1);
      }
      .cell {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        aspect-ratio: 1 / 1;
        justify-content: center;
        padding: var(--sp-1);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        cursor: pointer;
        transition: border-color var(--duration) var(--ease), background var(--duration) var(--ease);
      }
      .cell:hover {
        border-color: var(--primary);
      }
      .cell:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .cell__num {
        font-size: var(--fs-sm);
        font-weight: 600;
      }
      .cell__dot {
        inline-size: 6px;
        block-size: 6px;
        border-radius: var(--radius-pill);
        background: var(--primary);
      }
      .cell--out {
        color: var(--text-subtle);
        background: var(--surface-alt);
      }
      .cell--out .cell__num {
        font-weight: 400;
      }
      .cell--today {
        border-color: var(--border-strong);
      }
      .cell--sel {
        border-color: var(--primary);
        background: var(--primary-soft);
        color: var(--primary);
      }
      .agenda__day {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding-block-start: var(--sp-3);
        border-block-start: 1px solid var(--border);
      }
      .agenda__day-title {
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: 650;
        color: var(--text-muted);
      }
      .agenda__none {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-subtle);
      }
      .agenda__visit {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--sp-3);
        align-items: center;
        padding: var(--sp-2);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .agenda__visit-time {
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .agenda__visit-body {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
      .banner {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        margin-block-start: var(--sp-4);
        padding: var(--sp-3) var(--sp-4);
        background: var(--info-100);
        border: 1px solid var(--info-500);
        border-radius: var(--radius);
        color: var(--text);
      }
      .banner__text {
        flex: 1;
        margin: 0;
        min-width: 0;
        font-size: var(--fs-sm);
        overflow-wrap: anywhere;
      }
      @media (max-width: 640px) {
        .visit {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .visit__actions {
          grid-column: 1 / -1;
          flex-direction: row;
        }
      }
    `,
  ],
})
export class PatientAppointmentsComponent implements OnInit {
  private readonly entities = inject(EntitiesService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  readonly view = signal<'list' | 'agenda'>('list');
  readonly upcoming = signal<Visit[]>([]);
  readonly past = signal<Visit[]>([]);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly cancelOpen = signal(false);
  readonly cancelling = signal(false);
  readonly cancelBlocked = signal(false);

  readonly selectedDay = signal<string>(dateKey(new Date()));
  private readonly month = signal<Date>(firstOfMonth(new Date()));

  /** department id -> the labels of the doctors who work there (reference data). */
  private readonly doctorsByDept = signal<Map<string, string[]>>(new Map());

  private cancelId: string | null = null;

  readonly cardTitle = computed(() => this.translate.instant('patient.appointments.title'));
  readonly isEmpty = computed(() => this.upcoming().length === 0 && this.past().length === 0);

  readonly agenda = computed(() => this.buildAgenda(this.month(), this.selectedDay()));

  agendaTitle(): string {
    return this.translate.instant('patient.appointments.agendaTitle');
  }

  agendaDayVisits(): Visit[] {
    return this.agenda()?.selected ?? [];
  }

  ngOnInit(): void {
    // Resolve the reference doctor/department map first, so the first visit
    // render can already name the department's doctors.
    this.entities
      .list('doctors', { pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => {
        const map = new Map<string, string[]>();
        for (const doctor of page.items) {
          const department = this.singleRef(doctor.relations['department']);
          if (!department) continue;
          const bucket = map.get(department.id);
          if (bucket) bucket.push(doctor.label);
          else map.set(department.id, [doctor.label]);
        }
        this.doctorsByDept.set(map);
        this.load();
      });
  }

  load(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.entities
      .list('appointments', { pageSize: 100, sort: 'date', order: 'asc' })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(this.explain(error));
          this.loading.set(false);
          return of(EMPTY_PAGE);
        }),
      )
      .subscribe((page) => {
        const visits = this.toVisits(page.items);
        const now = Date.now();
        this.upcoming.set(visits.filter((visit) => timeOf(visit.date) >= now));
        this.past.set(visits.filter((visit) => timeOf(visit.date) < now).reverse());
        this.selectedDay.set(dateKey(new Date()));
        this.loading.set(false);
      });
  }

  // --- month grid ------------------------------------------------------------------

  prevMonth(): void {
    const value = this.month();
    this.month.set(firstOfMonth(new Date(value.getFullYear(), value.getMonth() - 1, 1, 12)));
  }

  nextMonth(): void {
    const value = this.month();
    this.month.set(firstOfMonth(new Date(value.getFullYear(), value.getMonth() + 1, 1, 12)));
  }

  selectDay(key: string): void {
    this.selectedDay.set(key);
  }

  private buildAgenda(anchor: Date, selectedKey: string): {
    title: string;
    selectedLabel: string;
    days: AgendaDay[];
    selected: Visit[];
  } {
    const start = firstOfMonth(anchor);
    const gridStart = addDays(start, -((start.getDay() + 6) % 7));
    const fmt = new Intl.DateTimeFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      month: 'long',
      year: 'numeric',
      weekday: 'short',
      day: 'numeric',
    });
    const days: AgendaDay[] = [];
    for (let i = 0; i < 42; i += 1) {
      const date = addDays(gridStart, i);
      days.push({
        key: dateKey(date),
        date,
        dayNumber: date.getDate(),
        label: fmt.format(date),
        inMonth: date.getMonth() === anchor.getMonth(),
        isToday: dateKey(date) === dateKey(new Date()),
        visits: [],
      });
    }

    const byKey = new Map(days.map((day) => [day.key, day]));
    for (const visit of [...this.upcoming(), ...this.past()]) {
      const bucket = byKey.get(dayKey(visit.date));
      if (bucket) bucket.visits.push(visit);
    }
    for (const day of days) day.visits.sort((a, b) => timeOf(a.date) - timeOf(b.date));

    const monthFmt = new Intl.DateTimeFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      month: 'long',
      year: 'numeric',
    });
    const selected = byKey.get(selectedKey);
    return {
      title: monthFmt.format(anchor),
      selectedLabel: selected ? fmt.format(selected.date) : monthFmt.format(anchor),
      days,
      selected: selected ? selected.visits : [],
    };
  }

  // --- mapping ---------------------------------------------------------------------

  private toVisits(items: Individual[]): Visit[] {
    return items.map((item) => this.toVisit(item));
  }

  private toVisit(item: Individual): Visit {
    const date = this.fieldText(item, 'date');
    const department = this.singleRef(item.relations['department']);
    return {
      id: item.id,
      iri: item.iri,
      date,
      status: this.fieldText(item, 'status'),
      type: this.typeOf(item),
      departmentId: department?.id ?? null,
      departmentLabel: department?.label ?? this.translate.instant('patient.appointments.noDepartment'),
      doctorLabel: this.doctorLabel(department?.id ?? null),
      dayLabel: this.dayLabel(date),
      timeLabel: this.timeLabel(date),
    };
  }

  private doctorLabel(departmentId: string | null): string | null {
    if (!departmentId) return null;
    const names = this.doctorsByDept().get(departmentId);
    if (!names || names.length === 0) return null;
    return names.join(', ');
  }

  // --- cancellation ------------------------------------------------------------------

  private findVisit(id: string | null): Visit | null {
    if (!id) return null;
    return [...this.upcoming(), ...this.past()].find((visit) => visit.id === id) ?? null;
  }

  askCancel(visit: Visit): void {
    this.cancelId = visit.id;
    this.cancelBlocked.set(false);
    this.cancelOpen.set(true);
  }

  /** Only an open visit (pending / confirmed / scheduled) can be asked to cancel. */
  protected mayCancel(visit: Visit): boolean {
    const key = visit.status.trim().toLowerCase();
    return key === 'pending' || key === 'confirmed' || key === 'scheduled';
  }

  /** "Book another" prefills the request wizard with this visit's department. */
  protected bookAnother(visit: Visit): Record<string, string> {
    return visit.departmentId ? { department: visit.departmentId } : {};
  }

  onCancelOpenChange(open: boolean): void {
    this.cancelOpen.set(open);
    if (!open) this.cancelling.set(false);
  }

  cancelMessage(): string {
    const visit = this.findVisit(this.cancelId);
    if (!visit) return this.translate.instant('patient.appointments.cancelFallback');
    return this.translate.instant('patient.appointments.cancelBody', {
      when: `${visit.dayLabel} · ${visit.timeLabel}`,
      where: visit.departmentLabel,
    });
  }

  confirmCancel(): void {
    const visit = this.findVisit(this.cancelId);
    if (!visit) {
      this.cancelOpen.set(false);
      return;
    }
    this.cancelling.set(true);
    // Confirming and cancelling belong to the back office: a patient PATCH that
    // is refused with a 403 is explained by a banner, never retried silently.
    const body: EntityInput = { status: 'Cancelled' };
    this.entities.update('appointments', visit.id, body).subscribe({
      next: () => {
        this.cancelling.set(false);
        this.cancelOpen.set(false);
        this.cancelId = null;
        this.toast.success(
          this.translate.instant('patient.appointments.cancelDoneTitle'),
          this.translate.instant('patient.appointments.cancelDoneBody'),
        );
        this.load();
      },
      error: () => {
        this.cancelling.set(false);
        this.cancelOpen.set(false);
        this.cancelBlocked.set(true);
      },
    });
  }

  // --- labels ----------------------------------------------------------------------

  protected statusLabel(status: string): string {
    return labelOf(this.translate, `patient.appointments.status.${this.slug(status)}`, status);
  }

  protected typeLabel(type: string | null): string {
    if (!type) return this.translate.instant('patient.appointments.noType');
    return labelOf(this.translate, `patient.appointments.type.${this.slug(type)}`, type);
  }

  private fieldText(item: Individual, field: string): string {
    const value = item.fields[field];
    return value === null || value === undefined ? '' : String(value);
  }

  private typeOf(item: Individual): string | null {
    return item.types.find((type) => type !== 'MedicalAppointment' && type !== 'NamedIndividual') ?? null;
  }

  private singleRef(value: Ref[] | Ref | null | undefined): Ref | null {
    if (value === null || value === undefined) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  private dayLabel(value: string): string {
    return new Intl.DateTimeFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }).format(new Date(value));
  }

  private timeLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.translate.instant('patient.appointments.noTime');
    return new Intl.DateTimeFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
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
    if (status === 0) return this.translate.instant('patient.appointments.errorOffline');
    if (status === 401 || status === 403) return this.translate.instant('patient.appointments.errorAuth');
    return this.translate.instant('patient.appointments.errorGeneric');
  }

  protected rows(count: number): number[] {
    return Array.from({ length: count }, (_unused, index) => index);
  }
}
