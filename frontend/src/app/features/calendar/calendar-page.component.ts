import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { HttpErrorResponse } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FullCalendarModule } from '@fullcalendar/angular';
import DayGridPlugin from '@fullcalendar/daygrid';
import TimeGridPlugin from '@fullcalendar/timegrid';
import InteractionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import type {
  CalendarOptions,
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';

import { EntitiesService, MetaService } from '../../core/api/entity.service';
import type { EntityInput, EntityKey, EntityMeta, Individual, Page, Ref } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/toast/toast.service';
import { labelOf } from '../../core/util/labels';

import {
  STATUS_COLOR_TOKENS,
  addDays,
  findClashes,
  slotsOf,
  startOfDay,
  toCalendarEvents,
  toDateOnly,
  toLocalDateTime,
} from './calendar.utils';
import type { AppointmentSlot, ClashCandidate, StatusColorTokens, StatusColors, StatusKey, StatusPalette } from './calendar.utils';

import { EntityFormComponent } from '../records/entity-form.component';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiModalComponent } from '../../shared/ui/modal/ui-modal.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiSearchBoxComponent } from '../../shared/ui/search-box/ui-search-box.component';
import { UiSelectComponent, type SelectOption } from '../../shared/ui/select/ui-select.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';

/** The five statuses the calendar paints, in the order the legend shows them. */
const LEGEND_KEYS: StatusKey[] = ['confirmed', 'pending', 'scheduled', 'cancelled', 'neutral'];

/** Appointment types offered as a secondary colour cue, mapped to a token. */
const TYPE_TOKENS: { readonly key: string; readonly token: string }[] = [
  { key: 'Consultation', token: '--info-500' },
  { key: 'FollowUpAppointment', token: '--warning-500' },
  { key: 'EmergencyAppointment', token: '--danger-500' },
];

/**
 * The appointments calendar. A single FullCalendar surface driven entirely by
 * `EntitiesService.list('appointments', …)` mapped through `calendar.utils`:
 * navigation, filters and the visible range re-query the API, colours come from
 * the design tokens resolved for the active theme, and every write is a PATCH
 * through the same entity service. Create/edit reuse the metadata-driven
 * `entity-form`; a double-booking is warned about, never hard-blocked.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'page-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // FullCalendar paints DOM Angular does not own, so the calendar's own classes
  // must be reachable. Encapsulation is lifted and every selector is scoped
  // under `.calendar-page` so nothing leaks into the rest of the application.
  encapsulation: ViewEncapsulation.None,
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    FullCalendarModule,
    UiPageHeaderComponent,
    UiPageActionsDirective,
    UiCardComponent,
    UiButtonComponent,
    UiIconComponent,
    UiSearchBoxComponent,
    UiSelectComponent,
    UiSkeletonComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiModalComponent,
    UiAlertComponent,
    EntityFormComponent,
  ],
  template: `
    <div class="page calendar-page">
      <ui-page-header [title]="'calendar.title' | translate" [subtitle]="subtitle()" icon="calendar">
        <div uiPageActions>
          <a class="list-link" [routerLink]="listRoute">
            <ui-icon name="table" [size]="15" />
            <span>{{ 'calendar.listView' | translate }}</span>
          </a>
          @if (canCreate()) {
            <ui-button icon="plus" size="sm" (click)="createBlank()">{{ 'calendar.new' | translate }}</ui-button>
          }
        </div>
      </ui-page-header>

      <ui-card pad="md">
        <div class="filters">
          <ui-search-box
            class="filters__search"
            [value]="search()"
            (valueChange)="onSearch($event)"
            [placeholder]="'calendar.searchPlaceholder' | translate"
            [loading]="loading()"
          />

          <ui-select
            class="filters__select"
            [label]="'calendar.filters.department' | translate"
            [placeholder]="'calendar.filters.allDepartment' | translate"
            [options]="departmentOptions()"
            [ngModel]="department()"
            (ngModelChange)="setDepartment($event)"
          />

          <ui-select
            class="filters__select"
            [label]="'calendar.filters.doctor' | translate"
            [placeholder]="'calendar.filters.allDoctor' | translate"
            [options]="doctorOptions()"
            [ngModel]="doctor()"
            (ngModelChange)="setDoctor($event)"
          />

          <ui-select
            class="filters__select"
            [label]="'calendar.filters.status' | translate"
            [placeholder]="'calendar.filters.allStatus' | translate"
            [options]="statusOptions()"
            [ngModel]="status()"
            (ngModelChange)="setStatus($event)"
          />

          @if (hasFilters()) {
            <ui-button variant="ghost" size="sm" icon="x" (click)="clearFilters()">
              {{ 'calendar.filters.clear' | translate }}
            </ui-button>
          }
        </div>

        <div class="legend" role="group" [attr.aria-label]="'calendar.legend.title' | translate">
          <div class="legend__group">
            @for (item of legend(); track item.key) {
              <span class="legend__item">
                <span class="legend__dot" [style.background]="item.color" aria-hidden="true"></span>
                {{ item.label }}
              </span>
            }
          </div>
          <div class="legend__group">
            @for (item of typeLegend(); track item.key) {
              <span class="legend__item">
                <span class="legend__bar" [style.background]="item.color" aria-hidden="true"></span>
                {{ item.label }}
              </span>
            }
          </div>
        </div>
      </ui-card>

      <div class="cal-wrap">
        <full-calendar [options]="options()" [events]="events()" />

        @if (loading()) {
          <div class="cal-overlay" aria-busy="true">
            <ui-skeleton width="96px" height="30px"></ui-skeleton>
            <ui-skeleton height="360px" radius="var(--radius-card)"></ui-skeleton>
          </div>
        } @else if (loadError()) {
          <div class="cal-overlay cal-overlay--scroll">
            <ui-error-state
              [title]="'calendar.errorTitle' | translate"
              [message]="'calendar.errorMessage' | translate"
              [hint]="'calendar.errorHint' | translate"
              (retry)="load()"
            />
          </div>
        } @else if (events().length === 0) {
          <div class="cal-overlay cal-overlay--scroll">
            <ui-empty-state
              icon="calendar"
              [title]="'calendar.emptyTitle' | translate"
              [hint]="'calendar.emptyHint' | translate"
            >
              @if (canCreate()) {
                <ui-button icon="plus" (click)="createBlank()">{{ 'calendar.new' | translate }}</ui-button>
              }
            </ui-empty-state>
          </div>
        }
      </div>

      <ui-modal
        [open]="dialogOpen()"
        (openChange)="dialogOpen.set($event)"
        [title]="dialogTitle()"
        size="xl"
        [busy]="saving()"
      >
        @if (conflicts().length > 0) {
          <ui-alert kind="warning" [dismissible]="false" [title]="'calendar.clash.title' | translate">
            {{ 'calendar.clash.text' | translate: { count: conflicts().length } }}
            <span class="clash-hint">{{ 'calendar.clash.hint' | translate }}</span>
          </ui-alert>
        }
        @if (dialogOpen()) {
          @if (metaFor(); as meta) {
            <entity-form
              [meta]="meta"
              [value]="formValue()"
              [busy]="saving()"
              [writable]="writable()"
              (submitted)="onSubmit($event)"
              (cancelled)="closeForm()"
            />
          }
        }
      </ui-modal>
    </div>
  `,
  styles: [
    `
      .calendar-page {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }

      .calendar-page .list-link {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-3);
        color: var(--primary);
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        font-size: var(--fs-sm);
        text-decoration: none;
        transition:
          color var(--duration) var(--ease),
          border-color var(--duration) var(--ease);
      }
      .calendar-page .list-link:hover {
        color: var(--primary-hover);
        border-color: var(--primary);
      }
      .calendar-page .list-link:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }

      .calendar-page .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--sp-3);
      }
      .calendar-page .filters__search {
        flex: 1 1 220px;
        min-width: 0;
      }
      .calendar-page .filters__select {
        flex: 1 1 180px;
        min-width: 0;
      }

      .calendar-page .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-4);
        margin-block-start: var(--sp-4);
        padding-block-start: var(--sp-3);
        border-block-start: 1px solid var(--border);
      }
      .calendar-page .legend__group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-3);
      }
      .calendar-page .legend__item {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        color: var(--text-muted);
        font-size: var(--fs-xs);
      }
      .calendar-page .legend__dot {
        width: 12px;
        height: 12px;
        border-radius: var(--radius-pill);
        border: 1px solid var(--border);
      }
      .calendar-page .legend__bar {
        width: 4px;
        height: 14px;
        border-radius: var(--radius-pill);
      }

      /* The calendar scrolls inside its own container so the page never does. */
      .calendar-page .cal-wrap {
        position: relative;
        overflow-x: auto;
        overflow-y: hidden;
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
        padding: var(--sp-3);
      }
      .calendar-page full-calendar {
        display: block;
        min-width: 720px;
      }

      .calendar-page .cal-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding: var(--sp-4);
        background: var(--surface);
      }
      .calendar-page .cal-overlay--scroll {
        align-items: center;
        justify-content: center;
        overflow-y: auto;
      }

      .calendar-page .clash-hint {
        display: block;
        margin-block-start: var(--sp-1);
      }

      /* Event colours come from the resolved tokens; the left bar is the type cue. */
      .calendar-page .fc {
        --fc-border-color: var(--border);
        --fc-page-bg-color: var(--surface);
        --fc-neutral-bg-color: var(--bg-sunken);
        --fc-today-bg-color: var(--primary-soft);
        --fc-event-selected-overlay-color: transparent;
        font-size: var(--fs-sm);
      }
      .calendar-page .fc .fc-toolbar {
        flex-wrap: wrap;
        gap: var(--sp-3);
        margin-block-end: var(--sp-3);
      }
      .calendar-page .fc .fc-toolbar-title {
        font-size: var(--fs-lg);
        color: var(--text);
      }
      .calendar-page .fc .fc-button-primary {
        color: var(--text);
        background: var(--surface);
        border-color: var(--border);
        text-transform: capitalize;
      }
      .calendar-page .fc .fc-button-primary:hover:not(:disabled) {
        background: var(--primary-soft);
        border-color: var(--primary);
        color: var(--primary);
      }
      .calendar-page .fc .fc-button-primary:not(:disabled).fc-button-active,
      .calendar-page .fc .fc-button-primary:not(:disabled):active {
        background: var(--primary);
        border-color: var(--primary);
        color: var(--text-inverse);
      }
      .calendar-page .fc .fc-button:focus,
      .calendar-page .fc .fc-button:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .calendar-page .fc .fc-col-header-cell-cushion,
      .calendar-page .fc .fc-daygrid-day-number,
      .calendar-page .fc .fc-timegrid-slot-label-cushion,
      .calendar-page .fc .fc-list-day-text,
      .calendar-page .fc .fc-list-day-side-text {
        color: var(--text-muted);
        text-decoration: none;
      }
      .calendar-page .fc .fc-list-event:hover td {
        background: var(--bg-hover);
      }

      .calendar-page .fc-event.sched-event {
        border-radius: var(--radius-input);
        cursor: pointer;
      }
      .calendar-page .fc-event {
        border-width: 1px;
      }
      .calendar-page .sched-event--confirmed {
        box-shadow: inset 3px 0 0 0 var(--success-500);
      }
      .calendar-page .sched-event--pending {
        box-shadow: inset 3px 0 0 0 var(--warning-500);
      }
      .calendar-page .sched-event--scheduled {
        box-shadow: inset 3px 0 0 0 var(--info-500);
      }
      .calendar-page .sched-event--cancelled {
        box-shadow: inset 3px 0 0 0 var(--danger-500);
      }
      /* Appointment type is the secondary cue: a left accent bar per facet. */
      .calendar-page .sched-type-Consultation {
        box-shadow: inset 6px 0 0 0 var(--info-500);
      }
      .calendar-page .sched-type-FollowUpAppointment {
        box-shadow: inset 6px 0 0 0 var(--warning-500);
      }
      .calendar-page .sched-type-EmergencyAppointment {
        box-shadow: inset 6px 0 0 0 var(--danger-500);
      }

      @media (max-width: 640px) {
        .calendar-page .fc .fc-toolbar {
          flex-direction: column;
          align-items: stretch;
        }
        .calendar-page .fc .fc-toolbar-chunk {
          display: flex;
          justify-content: space-between;
          gap: var(--sp-2);
        }
      }
    `,
  ],
})
export class CalendarPageComponent {
  private readonly entities = inject(EntitiesService);
  private readonly meta = inject(MetaService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);

  protected readonly listRoute = '/records/appointments';

  private readonly pageSize = 100;

  /** Filter state, all signals; every change re-queries the API. */
  protected readonly search = signal('');
  protected readonly department = signal<string | null>(null);
  protected readonly doctor = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);

  /** The visible calendar window, kept in sync with FullCalendar's `datesSet`. */
  private readonly range = signal<{ from: string; to: string }>(initialWindow());
  private rangeKey = '';

  private readonly rawItems = signal<Individual[]>([]);
  private readonly doctorsByPatient = signal<ReadonlyMap<string, readonly string[]>>(new Map());

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);

  /** Dialog state for create/edit; `editingId` decides create vs update. */
  protected readonly dialogOpen = signal(false);
  protected readonly saving = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly formValue = signal<Individual | null>(null);
  protected readonly conflicts = signal<AppointmentSlot[]>([]);
  private readonly conflictAcknowledged = signal(false);

  protected readonly departmentOptions = signal<SelectOption[]>([]);
  protected readonly doctorOptions = signal<SelectOption[]>([]);

  readonly lang = signal<'en' | 'fr'>(this.translate.currentLang === 'fr' ? 'fr' : 'en');

  protected readonly canCreate = computed(() => this.auth.can('appointments', 'create'));
  protected readonly canUpdate = computed(() => this.auth.can('appointments', 'update'));
  protected readonly writable = computed(() => this.auth.editableFields('appointments'));

  protected readonly metaFor = computed<EntityMeta | null>(() => this.meta.of('appointments') ?? null);

  protected readonly subtitle = computed(() => {
    this.lang();
    return this.translate.instant('calendar.subtitle', { count: this.slots().length });
  });

  readonly slots = computed<AppointmentSlot[]>(() =>
    slotsOf(this.rawItems(), this.doctorsByPatient()),
  );

  /**
   * Status colours read their tokens through `getComputedStyle` on the host, so
   * the palette follows the active theme (light or dark) automatically.
   */
  readonly palette = computed<StatusPalette>(() => {
    this.theme.resolved();
    const style = getComputedStyle(this.host.nativeElement);
    const read = (token: string): string => style.getPropertyValue(token).trim();
    const resolve = (tokens: StatusColorTokens): StatusColors => ({
      background: read(tokens.background),
      border: read(tokens.border),
      text: read(tokens.text),
    });
    return {
      confirmed: resolve(STATUS_COLOR_TOKENS.confirmed),
      pending: resolve(STATUS_COLOR_TOKENS.pending),
      cancelled: resolve(STATUS_COLOR_TOKENS.cancelled),
      scheduled: resolve(STATUS_COLOR_TOKENS.scheduled),
      neutral: resolve(STATUS_COLOR_TOKENS.neutral),
    };
  });

  readonly events = computed<EventInput[]>(() =>
    toCalendarEvents(this.slots(), this.palette()).map((event) => ({ ...event })),
  );

  readonly options = computed<CalendarOptions>(() => ({
    plugins: [DayGridPlugin, TimeGridPlugin, InteractionPlugin],
    locale: this.lang() === 'fr' ? frLocale : 'en',
    initialView: 'dayGridMonth',
    height: 'auto',
    nowIndicator: true,
    dayMaxEvents: true,
    firstDay: this.lang() === 'fr' ? 1 : 0,
    weekNumbers: this.lang() === 'fr',
    editable: this.canUpdate(),
    eventStartEditable: this.canUpdate(),
    eventDurationEditable: false,
    selectable: this.canCreate(),
    unselectAuto: true,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay',
    },
    buttonText: {
      today: this.translate.instant('calendar.view.today'),
      month: this.translate.instant('calendar.view.month'),
      week: this.translate.instant('calendar.view.week'),
      day: this.translate.instant('calendar.view.day'),
    },
    datesSet: (arg: DatesSetArg) => this.onDatesSet(arg),
    eventClick: (arg: EventClickArg) => this.onEventClick(arg),
    select: (arg: DateSelectArg) => this.onSelect(arg),
    eventDrop: (arg: EventDropArg) => this.onEventDrop(arg),
  }));

  protected readonly dialogTitle = computed(() => {
    this.lang();
    return this.translate.instant(this.editingId() ? 'calendar.editTitle' : 'calendar.createTitle');
  });

  protected legend(): { key: StatusKey; label: string; color: string }[] {
    const palette = this.palette();
    return LEGEND_KEYS.map((key) => ({
      key,
      label: labelOf(this.translate, `calendar.status.${key}`, key),
      color: palette[key].border,
    }));
  }

  protected typeLegend(): { key: string; label: string; color: string }[] {
    return TYPE_TOKENS.map((item) => ({
      key: item.key,
      label: labelOf(this.translate, `calendar.type.${item.key}`, item.key),
      color: `var(${item.token})`,
    }));
  }

  constructor() {
    this.meta.load().subscribe({ error: () => undefined });
    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.lang.set(event.lang === 'fr' ? 'fr' : 'en'));
    this.loadReferenceData();
  }

  protected hasFilters(): boolean {
    return (
      this.search().trim().length > 0 ||
      this.department() !== null ||
      this.doctor() !== null ||
      this.status() !== null
    );
  }

  protected onSearch(term: string): void {
    this.search.set(term);
    this.load();
  }

  protected setDepartment(value: string | number | null): void {
    this.department.set(value === '' || value === null ? null : String(value));
    this.load();
  }

  protected setDoctor(value: string | number | null): void {
    this.doctor.set(value === '' || value === null ? null : String(value));
    this.load();
  }

  protected setStatus(value: string | number | null): void {
    this.status.set(value === '' || value === null ? null : String(value));
    this.load();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.department.set(null);
    this.doctor.set(null);
    this.status.set(null);
    this.load();
  }

  /** The list, the visible window and the filters all come from one request. */
  protected load(): void {
    this.loadError.set(false);
    this.loading.set(true);
    const window = this.range();
    const query: Record<string, string | number | boolean | null | undefined> = {
      page: 1,
      pageSize: this.pageSize,
      sort: 'date',
      order: 'asc',
      q: this.search().trim() || undefined,
      department: this.department() ?? undefined,
      doctor: this.doctor() ?? undefined,
      status: this.status() ?? undefined,
      dateFrom: window.from,
      dateTo: window.to,
    };
    this.entities.list('appointments', query).subscribe({
      next: (page: Page<Individual>) => {
        this.rawItems.set(page.items);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
      },
    });
  }

  /** Department and doctor filters need their choices; status comes from meta. */
  private loadReferenceData(): void {
    const allDepartments: SelectOption = {
      value: '',
      label: this.translate.instant('calendar.filters.allDepartment'),
    };
    const allDoctors: SelectOption = {
      value: '',
      label: this.translate.instant('calendar.filters.allDoctor'),
    };
    this.entities.refs('departments', undefined, 50).subscribe({
      next: (refs: Ref[]) =>
        this.departmentOptions.set([allDepartments, ...refs.map((ref) => ({ value: ref.id, label: ref.label }))]),
      error: () => this.departmentOptions.set([allDepartments]),
    });
    this.entities.refs('doctors', undefined, 50).subscribe({
      next: (refs: Ref[]) =>
        this.doctorOptions.set([allDoctors, ...refs.map((ref) => ({ value: ref.id, label: ref.label }))]),
      error: () => this.doctorOptions.set([allDoctors]),
    });

    // The appointment/doctor link lives on the patient (treatedBy), so the map
    // that lets conflict detection resolve doctors is read from the patients list.
    this.entities.list('patients', { page: 1, pageSize: this.pageSize }).subscribe({
      next: (page: Page<Individual>) => {
        const field = this.doctorRelationField('patients');
        const map = new Map<string, readonly string[]>();
        for (const patient of page.items) map.set(patient.id, this.refIds(patient, field));
        this.doctorsByPatient.set(map);
      },
      error: () => this.doctorsByPatient.set(new Map()),
    });
  }

  protected statusOptions(): SelectOption[] {
    const values = this.metaFor()?.data.find((field) => field.field === 'status')?.values ?? [];
    return [
      { value: '', label: this.translate.instant('calendar.filters.allStatus') },
      ...values.map((value) => ({
        value,
        label: labelOf(this.translate, `calendar.status.${value.toLowerCase()}`, value),
      })),
    ];
  }

  private onDatesSet(arg: DatesSetArg): void {
    const from = toDateOnly(arg.view.currentStart);
    const to = toDateOnly(addDays(arg.view.currentEnd, -1));
    const key = `${from}|${to}`;
    if (key === this.rangeKey) return;
    this.rangeKey = key;
    this.range.set({ from, to });
    this.load();
  }

  private onEventClick(arg: EventClickArg): void {
    if (!this.canUpdate()) return;
    const id = arg.event.id;
    const individual = this.rawItems().find((item) => item.id === id);
    if (individual) this.openEdit(individual);
  }

  private onSelect(arg: DateSelectArg): void {
    if (!this.canCreate()) return;
    this.openCreate(arg.start);
  }

  private onEventDrop(arg: EventDropArg): void {
    const id = arg.event.id;
    const date = arg.event.startStr;
    this.entities.update('appointments', id, { date }).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('calendar.rescheduled'), arg.event.title);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        arg.revert();
        this.toast.fromProblem(error);
      },
    });
  }

  protected createBlank(): void {
    if (this.canCreate()) this.openCreate(startOfDay());
  }

  private openCreate(start: Date): void {
    this.editingId.set(null);
    this.formValue.set(this.draft(start));
    this.resetConflict();
    this.dialogOpen.set(true);
  }

  private openEdit(individual: Individual): void {
    this.editingId.set(individual.id);
    this.formValue.set(individual);
    this.resetConflict();
    this.dialogOpen.set(true);
  }

  protected closeForm(): void {
    this.resetConflict();
    this.dialogOpen.set(false);
  }

  protected onSubmit(body: EntityInput): void {
    if (!this.canCreate() && !this.canUpdate()) return;
    const clashes = findClashes(this.candidateFrom(body), this.slots());
    if (clashes.length > 0 && !this.conflictAcknowledged()) {
      this.conflicts.set(clashes);
      this.conflictAcknowledged.set(true);
      return;
    }
    this.resetConflict();
    this.performSave(body);
  }

  private performSave(body: EntityInput): void {
    const id = this.editingId();
    this.saving.set(true);
    const call = id ? this.entities.update('appointments', id, body) : this.entities.create('appointments', body);
    call.subscribe({
      next: (saved: Individual) => {
        this.saving.set(false);
        this.closeForm();
        this.toast.success(
          this.translate.instant(id ? 'calendar.saved' : 'calendar.created'),
          saved.label,
        );
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.toast.fromProblem(error);
      },
    });
  }

  private resetConflict(): void {
    this.conflicts.set([]);
    this.conflictAcknowledged.set(false);
  }

  private candidateFrom(body: EntityInput): ClashCandidate {
    const dateRaw = body['date'];
    const relations = this.relationsOf(body);
    const patientId = relations['patient']?.[0] ?? null;
    const doctorIds = patientId === null ? [] : (this.doctorsByPatient().get(patientId) ?? []);
    return {
      id: this.editingId(),
      date: typeof dateRaw === 'string' ? dateRaw : '',
      doctorIds,
      departmentId: relations['department']?.[0] ?? null,
    };
  }

  private relationsOf(body: EntityInput): Record<string, string[]> {
    const relations = body['relations'];
    const out: Record<string, string[]> = {};
    if (relations) {
      for (const [key, value] of Object.entries(relations)) {
        out[key] = Array.isArray(value) ? value : [];
      }
    }
    return out;
  }

  private draft(start: Date): Individual {
    return {
      id: '',
      iri: '',
      label: '',
      types: ['MedicalAppointment'],
      fields: { date: toLocalDateTime(start) },
      relations: {},
    };
  }

  /** The relation field on the entity that points at doctors (e.g. `doctors`). */
  private doctorRelationField(key: EntityKey): string {
    const relation = this.meta.of(key)?.relations.find((item) => item.target === 'doctors');
    return relation?.field ?? 'doctors';
  }

  private refIds(item: Individual, field: string): string[] {
    const raw = item.relations[field];
    if (raw === null || raw === undefined) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((ref) => ref.id);
  }
}

/** The first window queried before FullCalendar reports its own visible range. */
function initialWindow(): { from: string; to: string } {
  const start = startOfDay();
  return { from: toDateOnly(start), to: toDateOnly(addDays(start, 41)) };
}
