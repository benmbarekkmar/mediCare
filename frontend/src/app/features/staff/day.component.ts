import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EntitiesService } from '../../core/api/entity.service';
import type { EntityInput, EntityKey, Individual, Page, Ref } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/toast/toast.service';
import { formatDate } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import {
  addDays,
  type AppointmentSlot,
  dayKey,
  groupByStatus,
  isSameDay,
  slotOf,
  startOfDay,
  timeOf,
  toDateOnly,
} from '../calendar/calendar.utils';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardActionsDirective, UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiDropdownComponent, type DropdownItem } from '../../shared/ui/dropdown/ui-dropdown.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiPageMetaDirective } from '../../shared/ui/page-header/ui-page-meta.directive';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiStatCardComponent } from '../../shared/ui/stat-card/ui-stat-card.component';

/** The appointment statuses the ontology's `appointmentStatus` vocabulary allows. */
const APPOINTMENT_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'] as const;

/** Reception shows its status groups in this order, unknown statuses come last. */
const STATUS_ORDER: string[] = [...APPOINTMENT_STATUSES];

/** Results that mean "the laboratory owes us a number". */
const PENDING_RESULTS = ['pending', 'absent', 'awaiting', 'awaitingresult', 'tbd', 'todo', 'unknown', 'n/a'];

/** One day of the doctor's week, or one status band of the receptionist's day. */
interface SlotGroup {
  readonly key: string;
  readonly heading: string;
  readonly count: number;
  readonly slots: readonly AppointmentSlot[];
}

/** A KPI tile: the label travels as a key so the pipe re-translates on switch. */
interface Kpi {
  readonly id: string;
  readonly labelKey: string;
  readonly icon: IconName;
  readonly value: number | null;
  readonly hintKey: string | null;
  readonly loading: boolean;
  readonly gradient: boolean;
}

/** A dashboard shortcut card. */
interface QuickLink {
  readonly id: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly icon: IconName;
  readonly labelKey: string;
  readonly hintKey: string;
}

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

/**
 * The working day of the two clinical-office roles, in one screen: the signed-in
 * role decides which sections are rendered.
 *
 * A DOCTOR lands on `/doctor/dashboard` and sees the day of the patients they
 * treat; a RECEPTIONIST lands on `/reception/dashboard` and runs the front desk:
 * today's queue by status, the visits waiting for a confirmation, the two create
 * shortcuts and the staff directory.
 *
 * Nothing is filtered down to "my" scope here: the API already scopes a doctor
 * token to its own patients (`/api/patients`, `/api/appointments`, `/api/tests`
 * all carry the `treatedBy` scope), so every list read is taken at face value.
 * The only client-side selection is the *content* filter the API does not offer:
 * tests whose result is still empty. Status writes stay inside what the
 * permission matrix allows the role to write (`status` on appointments).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'staff-day',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslateModule,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardActionsDirective,
    UiCardComponent,
    UiDropdownComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiIconComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
    UiPageMetaDirective,
    UiSkeletonComponent,
    UiStatCardComponent,
  ],
  template: `
    <div class="page day">
      <ui-page-header
        tone="hero"
        [title]="heading()"
        [subtitle]="subtitle()"
        [icon]="isDoctor() ? 'stethoscope' : 'calendar-check'"
      >
        <ng-template uiPageMeta>
          <ui-badge kind="info" [label]="roleLabel()"></ui-badge>
          @if (departmentName(); as department) {
            <ui-badge kind="neutral" [label]="department"></ui-badge>
          }
          @if (hospitalName(); as hospital) {
            <ui-badge kind="neutral" [label]="hospital"></ui-badge>
          }
        </ng-template>

        <ng-template uiPageActions>
          @if (!isDoctor()) {
            <ui-button icon="plus" size="sm" (click)="go('/records/appointments', createQuery())">
              {{ 'staff.day.reception.ctas.newAppointment' | translate }}
            </ui-button>
            <ui-button variant="secondary" icon="user" size="sm" (click)="go('/records/patients', createQuery())">
              {{ 'staff.day.reception.ctas.newPatient' | translate }}
            </ui-button>
          } @else {
            <ui-button icon="plus" size="sm" (click)="go('/records/appointments', createQuery())">
              {{ 'staff.day.doctor.links.newAppointment' | translate }}
            </ui-button>
          }
          <ui-button variant="outline" icon="refresh" size="sm" [loading]="busy()" (click)="load()">
            {{ 'common.refresh' | translate }}
          </ui-button>
        </ng-template>
      </ui-page-header>

      @if (fatal()) {
        <ui-error-state
          [title]="'ui.error.title' | translate"
          [message]="errorMessage()"
          [hint]="'staff.day.errorHint' | translate"
          (retry)="load()"
        />
      } @else {
        <section class="grid-kpi" [attr.aria-label]="'staff.day.kpiLabel' | translate">
          @for (k of kpis(); track k.id) {
            <ui-stat-card
              [value]="k.value === null ? '—' : k.value"
              [label]="k.labelKey | translate"
              [icon]="k.icon"
              [hint]="k.hintKey === null ? null : (k.hintKey | translate)"
              [loading]="k.loading"
              [gradient]="k.gradient"
            />
          }
        </section>

        @if (isDoctor()) {
          <section class="blocks">
            <ui-card
              [title]="'staff.day.doctor.today.title' | translate"
              [subtitle]="todaySubtitle()"
              icon="calendar-days"
              [pad]="'none'"
              elevated
            >
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/records/appointments">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'staff.day.allList' | translate }}
                  </ui-button>
                </a>
              </ng-template>

              @if (slotsFailed()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="errorMessage()"
                  (retry)="loadAppointments()"
                />
              } @else if (slotsLoading()) {
                <div class="pad stack-sm" aria-busy="true" [attr.aria-label]="'staff.day.loading' | translate">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="52px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (todaySlots().length === 0) {
                <ui-empty-state
                  icon="calendar-days"
                  [title]="'staff.day.doctor.today.empty' | translate"
                  [hint]="'staff.day.doctor.today.emptyHint' | translate"
                >
                  <ui-button variant="secondary" icon="plus" (click)="go('/records/appointments', createQuery())">
                    {{ 'staff.day.doctor.links.newAppointment' | translate }}
                  </ui-button>
                </ui-empty-state>
              } @else {
                <ul class="rows">
                  @for (slot of todaySlots(); track slot.id) {
                    <li class="row-item">
                      <span class="row-time">{{ timeText(slot.date) }}</span>
                      <span class="row-main">
                        <a class="link truncate" [routerLink]="patientLink(slot)">{{ patientName(slot) }}</a>
                        <span class="row-sub">
                          @if (slot.department) {
                            <span class="truncate">{{ slot.department.label }}</span>
                          }
                          <a class="row-open" [routerLink]="['/records/appointments', slot.id]">
                            {{ 'staff.day.open' | translate }}
                          </a>
                        </span>
                      </span>
                      <span class="row-end">
                        <ui-badge kind="status" [status]="slot.status" [label]="statusLabel(slot.status)"></ui-badge>
                        @if (canWriteStatus()) {
                          <ui-dropdown
                            [items]="statusItems(slot.status)"
                            [triggerIcon]="'pencil'"
                            [triggerLabel]="changeStatusLabel()"
                            [menuLabel]="changeStatusLabel()"
                            [disabled]="isBusyRow(slot.id)"
                            align="end"
                            (itemSelect)="onStatusChange(slot, $event)"
                          />
                        }
                      </span>
                    </li>
                  }
                </ul>
              }
            </ui-card>

            <ui-card
              [title]="'staff.day.doctor.week.title' | translate"
              [subtitle]="weekSubtitle()"
              icon="calendar-check"
              [pad]="'none'"
            >
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/calendar">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'staff.day.doctor.links.openCalendar' | translate }}
                  </ui-button>
                </a>
              </ng-template>

              @if (slotsLoading()) {
                <div class="pad stack-sm" aria-busy="true">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="52px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (weekGroups().length === 0) {
                <ui-empty-state
                  icon="calendar"
                  [title]="'staff.day.doctor.week.empty' | translate"
                  [hint]="'staff.day.doctor.week.emptyHint' | translate"
                />
              } @else {
                @for (group of weekGroups(); track group.key) {
                  <p class="group-heading">
                    <span class="group-title">{{ group.heading }}</span>
                    <span class="group-count">{{ 'staff.day.groupCount' | translate: { count: group.count } }}</span>
                  </p>
                  <ul class="rows">
                    @for (slot of group.slots; track slot.id) {
                      <li class="row-item">
                        <span class="row-time">{{ timeText(slot.date) }}</span>
                        <span class="row-main">
                          <a class="link truncate" [routerLink]="['/records/appointments', slot.id]">
                            {{ patientName(slot) }}
                          </a>
                          @if (slot.department) {
                            <span class="row-sub"><span class="truncate">{{ slot.department.label }}</span></span>
                          }
                        </span>
                        <span class="row-end">
                          <ui-badge
                            kind="status"
                            [status]="slot.status"
                            [label]="statusLabel(slot.status)"
                          ></ui-badge>
                        </span>
                      </li>
                    }
                  </ul>
                }
              }
            </ui-card>
          </section>

          <section class="blocks">
            <ui-card
              [title]="'staff.day.doctor.tests.title' | translate"
              [subtitle]="testsSubtitle()"
              icon="flask"
              [pad]="'none'"
            >
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/records/tests">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'staff.day.allList' | translate }}
                  </ui-button>
                </a>
              </ng-template>

              @if (testsFailed()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="errorMessage()"
                  (retry)="loadTests()"
                />
              } @else if (testsLoading()) {
                <div class="pad stack-sm" aria-busy="true">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="56px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (pendingTestRows().length === 0) {
                <ui-empty-state
                  icon="flask"
                  [title]="'staff.day.doctor.tests.empty' | translate"
                  [hint]="'staff.day.doctor.tests.emptyHint' | translate"
                >
                  @if (canCreate('tests')) {
                    <ui-button variant="secondary" icon="plus" (click)="go('/records/tests', createQuery())">
                      {{ 'staff.day.doctor.links.newTest' | translate }}
                    </ui-button>
                  }
                </ui-empty-state>
              } @else {
                <ul class="rows">
                  @for (test of pendingTestRows(); track test.id) {
                    <li class="row-item">
                      <span class="row-time">{{ testDate(test) }}</span>
                      <span class="row-main">
                        <a class="link truncate" [routerLink]="['/records/tests', test.id]">{{ test.label }}</a>
                        <span class="row-sub">
                          @if (testPatient(test); as patient) {
                            <a class="row-open" [routerLink]="['/records/patients', patient.id]">{{ patient.label }}</a>
                          }
                          <span class="truncate">{{ testTypeLabel(test) }}</span>
                        </span>
                      </span>
                      <span class="row-end">
                        <ui-badge kind="warning" [label]="'staff.day.doctor.tests.pending' | translate"></ui-badge>
                      </span>
                    </li>
                  }
                </ul>
              }
            </ui-card>

            <div class="side">
              <ui-card [title]="'staff.day.doctor.department.title' | translate" icon="building">
                @if (profileLoading()) {
                  <div class="stack-sm" aria-busy="true">
                    <ui-skeleton height="20px" width="60%"></ui-skeleton>
                    <ui-skeleton height="20px" width="40%"></ui-skeleton>
                  </div>
                } @else if (departmentName()) {
                  <p class="card-strong">{{ departmentName() }}</p>
                  @if (departmentDetail(); as detail) {
                    <p class="card-muted">{{ detail }}</p>
                  }
                  <div class="row">
                    <ui-button
                      variant="outline"
                      size="sm"
                      icon="arrow-right"
                      (click)="go('/records/departments', searchQuery(departmentName() ?? ''))"
                    >
                      {{ 'staff.day.doctor.department.open' | translate }}
                    </ui-button>
                  </div>
                } @else {
                  <ui-empty-state
                    compact
                    icon="building"
                    [title]="'staff.day.doctor.department.empty' | translate"
                    [hint]="'staff.day.noProfileHint' | translate"
                  />
                }
              </ui-card>

              <ui-card [title]="'staff.day.doctor.hospital.title' | translate" icon="hospital">
                @if (profileLoading()) {
                  <div class="stack-sm" aria-busy="true">
                    <ui-skeleton height="20px" width="55%"></ui-skeleton>
                  </div>
                } @else if (hospitalName()) {
                  <p class="card-strong">{{ hospitalName() }}</p>
                  <div class="row">
                    <ui-button
                      variant="outline"
                      size="sm"
                      icon="arrow-right"
                      (click)="go('/records/hospitals', searchQuery(hospitalName() ?? ''))"
                    >
                      {{ 'staff.day.doctor.hospital.open' | translate }}
                    </ui-button>
                  </div>
                } @else {
                  <ui-empty-state
                    compact
                    icon="hospital"
                    [title]="'staff.day.doctor.hospital.empty' | translate"
                    [hint]="'staff.day.noProfileHint' | translate"
                  />
                }
              </ui-card>
            </div>
          </section>

          <section class="links" [attr.aria-label]="'common.quickActions' | translate">
            @for (link of quickLinks(); track link.id) {
              <a class="link-card" [routerLink]="link.path" [queryParams]="link.query">
                <ui-icon [name]="link.icon" [size]="20" />
                <span class="link-card__label">{{ link.labelKey | translate }}</span>
                <span class="link-card__hint">{{ link.hintKey | translate }}</span>
              </a>
            }
          </section>
        } @else {
          <section class="cta">
            <ui-card [title]="'staff.day.reception.ctas.title' | translate" [pad]="'lg'" elevated>
              <p class="cta__hint">{{ 'staff.day.reception.ctas.hint' | translate }}</p>
              <div class="cta__row">
                @if (canCreate('appointments')) {
                  <ui-button icon="plus" [fullWidth]="true" (click)="go('/records/appointments', createQuery())">
                    {{ 'staff.day.reception.ctas.newAppointment' | translate }}
                  </ui-button>
                }
                @if (canCreate('patients')) {
                  <ui-button
                    variant="secondary"
                    icon="user"
                    [fullWidth]="true"
                    (click)="go('/records/patients', createQuery())"
                  >
                    {{ 'staff.day.reception.ctas.newPatient' | translate }}
                  </ui-button>
                }
              </div>
            </ui-card>
          </section>

          <section class="blocks">
            <ui-card
              [title]="'staff.day.reception.queue.title' | translate"
              [subtitle]="queueSubtitle()"
              icon="list-checks"
              [pad]="'none'"
              elevated
            >
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/calendar">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'staff.day.reception.queue.calendar' | translate }}
                  </ui-button>
                </a>
              </ng-template>

              @if (slotsFailed()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="errorMessage()"
                  (retry)="loadAppointments()"
                />
              } @else if (slotsLoading()) {
                <div class="pad stack-sm" aria-busy="true" [attr.aria-label]="'staff.day.loading' | translate">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="52px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (statusGroups().length === 0) {
                <ui-empty-state
                  icon="calendar-days"
                  [title]="'staff.day.reception.queue.empty' | translate"
                  [hint]="'staff.day.reception.queue.emptyHint' | translate"
                >
                  @if (canCreate('appointments')) {
                    <ui-button variant="secondary" icon="plus" (click)="go('/records/appointments', createQuery())">
                      {{ 'staff.day.reception.ctas.newAppointment' | translate }}
                    </ui-button>
                  }
                </ui-empty-state>
              } @else {
                <div class="chips">
                  @for (group of statusGroups(); track group.key) {
                    <span class="chip">
                      <ui-badge kind="status" [status]="group.key" [label]="statusLabel(group.key)"></ui-badge>
                      <span class="chip__count">{{ group.count }}</span>
                    </span>
                  }
                </div>
                @for (group of statusGroups(); track group.key) {
                  <p class="group-heading">
                    <span class="group-title">{{ statusLabel(group.key) }}</span>
                    <span class="group-count">{{ 'staff.day.groupCount' | translate: { count: group.count } }}</span>
                  </p>
                  <ul class="rows">
                    @for (slot of group.slots; track slot.id) {
                      <li class="row-item">
                        <span class="row-time">{{ timeText(slot.date) }}</span>
                        <span class="row-main">
                          <a class="link truncate" [routerLink]="patientLink(slot)">{{ patientName(slot) }}</a>
                          <span class="row-sub">
                            @if (slot.department) {
                              <span class="truncate">{{ slot.department.label }}</span>
                            }
                            <a class="row-open" [routerLink]="['/records/appointments', slot.id]">
                              {{ 'staff.day.open' | translate }}
                            </a>
                          </span>
                        </span>
                        <span class="row-end">
                          <ui-badge kind="status" [status]="slot.status" [label]="statusLabel(slot.status)"></ui-badge>
                        </span>
                      </li>
                    }
                  </ul>
                }
              }
            </ui-card>

            <ui-card
              [title]="'staff.day.reception.pending.title' | translate"
              [subtitle]="pendingSubtitle()"
              icon="clock"
              [pad]="'none'"
            >
              @if (pendingFailed()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="errorMessage()"
                  (retry)="loadPending()"
                />
              } @else if (pendingLoading()) {
                <div class="pad stack-sm" aria-busy="true">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="64px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (pendingSlots().length === 0) {
                <ui-empty-state
                  icon="circle-check"
                  [title]="'staff.day.reception.pending.empty' | translate"
                  [hint]="'staff.day.reception.pending.emptyHint' | translate"
                />
              } @else {
                <ul class="rows">
                  @for (slot of pendingSlots(); track slot.id) {
                    <li class="row-item row-item--tall">
                      <span class="row-time">{{ timeText(slot.date) }}</span>
                      <span class="row-main">
                        <a class="link truncate" [routerLink]="patientLink(slot)">{{ patientName(slot) }}</a>
                        <span class="row-sub">
                          <span class="truncate">{{ dayText(slot.date) }}</span>
                          @if (slot.department) {
                            <span class="truncate">{{ slot.department.label }}</span>
                          }
                          <a class="row-open" [routerLink]="['/records/appointments', slot.id]">
                            {{ 'staff.day.open' | translate }}
                          </a>
                        </span>
                      </span>
                      <span class="row-end">
                        @if (canWriteStatus()) {
                          <ui-button
                            size="sm"
                            icon="check"
                            [loading]="busyId() === slot.id + '-Confirmed'"
                            [disabled]="busyId() !== null"
                            (click)="setStatus(slot, 'Confirmed')"
                          >
                            {{ 'staff.day.reception.pending.confirm' | translate }}
                          </ui-button>
                          <ui-button
                            variant="danger"
                            size="sm"
                            icon="x"
                            [loading]="busyId() === slot.id + '-Cancelled'"
                            [disabled]="busyId() !== null"
                            (click)="setStatus(slot, 'Cancelled')"
                          >
                            {{ 'staff.day.reception.pending.cancel' | translate }}
                          </ui-button>
                        } @else {
                          <ui-badge kind="status" [status]="slot.status" [label]="statusLabel(slot.status)"></ui-badge>
                        }
                      </span>
                    </li>
                  }
                </ul>
              }
            </ui-card>
          </section>

          <section class="blocks">
            <ui-card
              [title]="'staff.day.reception.doctors.title' | translate"
              [subtitle]="directoryCountLabel(doctorItems())"
              icon="stethoscope"
              [pad]="'none'"
            >
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/records/doctors">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'staff.day.allList' | translate }}
                  </ui-button>
                </a>
              </ng-template>
              @if (directoryFailed()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="errorMessage()"
                  (retry)="loadDirectory()"
                />
              } @else if (directoryLoading()) {
                <div class="pad stack-sm" aria-busy="true">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="44px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (doctorItems().length === 0) {
                <ui-empty-state
                  icon="stethoscope"
                  [title]="'staff.day.reception.directoryEmpty' | translate"
                  [hint]="'staff.day.reception.directoryHint' | translate"
                />
              } @else {
                <ul class="rows">
                  @for (doctor of doctorItems(); track doctor.id) {
                    <li class="row-item row-item--plain">
                      <span class="row-main">
                        <a class="link truncate" [routerLink]="['/records/doctors', doctor.id]">{{ doctor.label }}</a>
                        <span class="row-sub">
                          @if (specialtyOf(doctor); as specialty) {
                            <span class="truncate">{{ specialty }}</span>
                          }
                          @if (departmentOf(doctor); as department) {
                            <span class="truncate">{{ department }}</span>
                          }
                        </span>
                      </span>
                    </li>
                  }
                </ul>
              }
            </ui-card>

            <ui-card
              [title]="'staff.day.reception.departments.title' | translate"
              [subtitle]="directoryCountLabel(departmentItems())"
              icon="building"
              [pad]="'none'"
            >
              <ng-template uiCardActions>
                <a class="card-link" routerLink="/records/departments">
                  <ui-button variant="ghost" size="sm" iconRight="arrow-right">
                    {{ 'staff.day.allList' | translate }}
                  </ui-button>
                </a>
              </ng-template>
              @if (directoryFailed()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="errorMessage()"
                  (retry)="loadDirectory()"
                />
              } @else if (directoryLoading()) {
                <div class="pad stack-sm" aria-busy="true">
                  @for (row of skeletonRows; track row) {
                    <ui-skeleton height="44px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else if (departmentItems().length === 0) {
                <ui-empty-state
                  icon="building"
                  [title]="'staff.day.reception.directoryEmpty' | translate"
                  [hint]="'staff.day.reception.directoryHint' | translate"
                />
              } @else {
                <ul class="rows">
                  @for (department of departmentItems(); track department.id) {
                    <li class="row-item row-item--plain">
                      <span class="row-main">
                        <a class="link truncate" [routerLink]="['/records/departments', department.id]">
                          {{ department.label }}
                        </a>
                        <span class="row-sub">
                          @if (hospitalOf(department); as hospital) {
                            <span class="truncate">{{ hospital }}</span>
                          }
                        </span>
                      </span>
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
      :host {
        display: block;
      }
      .day {
        display: flex;
        flex-direction: column;
        gap: var(--sp-5);
      }
      .blocks {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
        align-items: start;
      }
      .side {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
        min-width: 0;
      }
      .links {
        display: grid;
        gap: var(--sp-3);
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      }
      .link-card {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--sp-1) var(--sp-3);
        align-items: center;
        padding: var(--sp-4);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-sm);
        color: var(--text);
        text-decoration: none;
        min-width: 0;
        transition:
          border-color var(--duration) var(--ease),
          box-shadow var(--duration) var(--ease);
      }
      .link-card:hover {
        text-decoration: none;
        border-color: var(--primary);
        box-shadow: var(--shadow-md);
      }
      .link-card:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .link-card ui-icon {
        grid-row: span 2;
        color: var(--primary);
      }
      .link-card__label {
        font-size: var(--fs-md);
        font-weight: 650;
      }
      .link-card__hint {
        grid-column: 2;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .cta__hint {
        margin: 0 0 var(--sp-3);
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .cta__row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-3);
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .row-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--sp-3);
        padding: var(--sp-3) var(--sp-4);
        border-bottom: 1px solid var(--border);
        min-width: 0;
      }
      .rows .row-item:last-child {
        border-bottom: 0;
      }
      .row-item--tall {
        align-items: start;
      }
      .row-item--plain {
        grid-template-columns: minmax(0, 1fr);
      }
      .row-time {
        font-variant-numeric: tabular-nums;
        font-weight: 650;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .row-main {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        min-width: 0;
      }
      .row-sub {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-1) var(--sp-3);
        font-size: var(--fs-sm);
        color: var(--text-muted);
        min-width: 0;
      }
      .row-end {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--sp-2);
        min-width: 0;
      }
      .group-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
        margin: 0;
        padding: var(--sp-3) var(--sp-4) var(--sp-1);
        background: var(--surface-alt);
        border-bottom: 1px solid var(--border);
        font-size: var(--fs-sm);
      }
      .group-title {
        font-weight: 650;
        color: var(--text);
      }
      .group-count {
        color: var(--text-muted);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
        padding: var(--sp-3) var(--sp-4);
        border-bottom: 1px solid var(--border);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        padding: var(--sp-1) var(--sp-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        font-size: var(--fs-xs);
        font-weight: 650;
      }
      .chip__count {
        font-variant-numeric: tabular-nums;
        color: var(--text-muted);
      }
      .link,
      .row-open {
        color: var(--primary);
        border-radius: var(--radius-input);
        text-decoration: none;
      }
      .link:hover,
      .row-open:hover {
        color: var(--primary-hover);
        text-decoration: underline;
      }
      .link:focus-visible,
      .row-open:focus-visible,
      .card-link:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .row-open {
        font-size: var(--fs-xs);
        font-weight: 650;
        white-space: nowrap;
      }
      .card-link {
        text-decoration: none;
      }
      .card-strong {
        margin: 0;
        font-size: var(--fs-md);
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .card-muted {
        margin: var(--sp-1) 0 var(--sp-3);
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .pad {
        padding: var(--sp-4);
      }
      @media (max-width: 639px) {
        .row-item {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .row-end {
          grid-column: 1 / -1;
          justify-content: flex-start;
        }
        .row-item--tall .row-end {
          gap: var(--sp-2);
        }
      }
    `,
  ],
})
export class StaffDayComponent {
  private readonly entities = inject(EntitiesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly skeletonRows = ['a', 'b', 'c'];

  readonly profile = signal<Individual | null>(null);
  readonly department = signal<Ref | null>(null);
  readonly hospital = signal<Ref | null>(null);

  /** Appointments of the role's window, exactly as the API scoped them. */
  readonly windowItems = signal<Individual[]>([]);
  readonly pendingItems = signal<Individual[]>([]);
  readonly testItems = signal<Individual[]>([]);
  readonly doctorItems = signal<Individual[]>([]);
  readonly departmentItems = signal<Individual[]>([]);

  readonly patientTotal = signal<number | null>(null);
  readonly doctorTotal = signal<number | null>(null);

  readonly slotsLoading = signal(true);
  readonly slotsFailed = signal(false);
  readonly profileLoading = signal(false);
  readonly testsLoading = signal(false);
  readonly testsFailed = signal(false);
  readonly pendingLoading = signal(false);
  readonly pendingFailed = signal(false);
  readonly countsLoading = signal(false);
  readonly directoryLoading = signal(false);
  readonly directoryFailed = signal(false);
  readonly fatal = signal(false);
  readonly busyId = signal<string | null>(null);

  readonly isDoctor = computed(() => this.auth.hasRole('DOCTOR'));

  readonly busy = computed(
    () =>
      this.slotsLoading() ||
      this.testsLoading() ||
      this.pendingLoading() ||
      this.countsLoading() ||
      this.directoryLoading(),
  );

  readonly slots = computed(() => this.windowItems().map((item) => slotOf(item)));

  readonly todaySlots = computed(() => {
    const today = startOfDay();
    return this.slots()
      .filter((slot) => isSameDay(slot.date, today))
      .sort((a, b) => timeOf(a.date) - timeOf(b.date));
  });

  /** Tomorrow to day seven: today has its own section. */
  readonly weekGroups = computed<SlotGroup[]>(() => {
    const start = startOfDay();
    const groups: SlotGroup[] = [];
    for (let offset = 1; offset <= 7; offset += 1) {
      const day = addDays(start, offset);
      const key = toDateOnly(day);
      const slots = this.slots().filter((slot) => dayKey(slot.date) === key);
      if (slots.length > 0) groups.push({ key, heading: this.dayHeading(day), count: slots.length, slots });
    }
    return groups;
  });

  readonly statusGroups = computed<SlotGroup[]>(() => {
    const ordered: SlotGroup[] = [];
    const groups = groupByStatus(this.todaySlots());
    const extra = [...groups.keys()].filter((key) => !STATUS_ORDER.includes(key));
    const keys = [...STATUS_ORDER.filter((status) => groups.has(status)), ...extra];
    for (const key of keys) {
      const slots = groups.get(key) ?? [];
      ordered.push({ key, heading: this.statusLabel(key), count: slots.length, slots });
    }
    return ordered;
  });

  readonly pendingSlots = computed(() => this.pendingItems().map((item) => slotOf(item)));

  readonly pendingTests = computed(
    () => this.testItems().filter((test) => this.isPendingResult(test)),
  );

  readonly pendingTestRows = computed(() => this.pendingTests().slice(0, 6));

  readonly departmentName = computed(() => this.department()?.label ?? null);
  readonly hospitalName = computed(() => this.hospital()?.label ?? null);

  readonly kpis = computed<Kpi[]>(() => {
    if (this.isDoctor()) {
      return [
        {
          id: 'today',
          labelKey: 'staff.day.kpi.today',
          icon: 'calendar-days',
          value: this.todaySlots().length,
          hintKey: 'staff.day.kpi.todayHint',
          loading: this.slotsLoading(),
          gradient: true,
        },
        {
          id: 'week',
          labelKey: 'staff.day.kpi.week',
          icon: 'calendar-check',
          value: this.slots().length,
          hintKey: 'staff.day.kpi.weekHint',
          loading: this.slotsLoading(),
          gradient: true,
        },
        {
          id: 'patients',
          labelKey: 'staff.day.kpi.patients',
          icon: 'users',
          value: this.patientTotal(),
          hintKey: 'staff.day.kpi.patientsHint',
          loading: this.countsLoading(),
          gradient: false,
        },
        {
          id: 'tests',
          labelKey: 'staff.day.kpi.pendingTests',
          icon: 'flask',
          value: this.pendingTests().length,
          hintKey: 'staff.day.kpi.pendingTestsHint',
          loading: this.testsLoading(),
          gradient: false,
        },
      ];
    }
    return [
      {
        id: 'today',
        labelKey: 'staff.day.kpi.today',
        icon: 'calendar-days',
        value: this.todaySlots().length,
        hintKey: 'staff.day.kpi.todayHint',
        loading: this.slotsLoading(),
        gradient: true,
      },
      {
        id: 'pending',
        labelKey: 'staff.day.kpi.pending',
        icon: 'clock',
        value: this.pendingSlots().length,
        hintKey: 'staff.day.kpi.pendingHint',
        loading: this.pendingLoading(),
        gradient: true,
      },
      {
        id: 'patients',
        labelKey: 'staff.day.kpi.allPatients',
        icon: 'users',
        value: this.patientTotal(),
        hintKey: 'staff.day.kpi.allPatientsHint',
        loading: this.countsLoading(),
        gradient: false,
      },
      {
        id: 'doctors',
        labelKey: 'staff.day.kpi.doctors',
        icon: 'stethoscope',
        value: this.doctorTotal(),
        hintKey: 'staff.day.kpi.doctorsHint',
        loading: this.directoryLoading(),
        gradient: false,
      },
    ];
  });

  readonly quickLinks = computed<QuickLink[]>(() => {
    const links: QuickLink[] = [
      {
        id: 'appointment',
        path: '/records/appointments',
        query: { create: '1' },
        icon: 'calendar-check',
        labelKey: 'staff.day.doctor.links.newAppointment',
        hintKey: 'staff.day.doctor.links.newAppointmentHint',
      },
      {
        id: 'patients',
        path: '/records/patients',
        query: {},
        icon: 'users',
        labelKey: 'staff.day.doctor.links.myPatients',
        hintKey: 'staff.day.doctor.links.myPatientsHint',
      },
    ];
    if (this.auth.can('tests', 'create')) {
      links.push({
        id: 'test',
        path: '/records/tests',
        query: { create: '1' },
        icon: 'flask',
        labelKey: 'staff.day.doctor.links.newTest',
        hintKey: 'staff.day.doctor.links.newTestHint',
      });
    }
    links.push({
      id: 'calendar',
      path: '/calendar',
      query: {},
      icon: 'calendar',
      labelKey: 'staff.day.doctor.links.openCalendar',
      hintKey: 'staff.day.doctor.links.openCalendarHint',
    });
    return links;
  });

  constructor() {
    this.load();
  }

  // --- reads ---------------------------------------------------------------------

  /**
   * One pass per role. The account's own scope is whatever the API returns: a
   * doctor token only ever sees the appointments, patients and tests of the
   * patients it treats, so no list is narrowed down here.
   */
  load(): void {
    this.fatal.set(false);
    this.loadProfile();
    this.loadAppointments();
    this.loadCounts();
    if (this.isDoctor()) {
      this.loadTests();
    } else {
      this.loadPending();
      this.loadDirectory();
    }
  }

  /** Today through day seven for a doctor, today only at the front desk. */
  protected loadAppointments(): void {
    const start = startOfDay();
    const horizon = this.isDoctor() ? 7 : 0;
    const query: Record<string, string | number | boolean | null | undefined> = {
      dateFrom: toDateOnly(start),
      dateTo: toDateOnly(addDays(start, horizon)),
      pageSize: 100,
      sort: 'date',
      order: 'asc',
    };
    this.slotsLoading.set(true);
    this.slotsFailed.set(false);
    this.entities
      .list('appointments', query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.windowItems.set(page.items);
          this.slotsLoading.set(false);
        },
        error: () => {
          this.slotsLoading.set(false);
          this.slotsFailed.set(true);
          this.fatal.set(true);
        },
      });
  }

  /** Visits still waiting for a confirmation, in the next two weeks. */
  protected loadPending(): void {
    const start = startOfDay();
    this.pendingLoading.set(true);
    this.pendingFailed.set(false);
    this.entities
      .list('appointments', {
        status: 'Pending',
        dateFrom: toDateOnly(start),
        dateTo: toDateOnly(addDays(start, 14)),
        pageSize: 100,
        sort: 'date',
        order: 'asc',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.pendingItems.set(page.items);
          this.pendingLoading.set(false);
        },
        error: () => {
          this.pendingLoading.set(false);
          this.pendingFailed.set(true);
        },
      });
  }

  /** The linked individual: a doctor record, or the patient record it maps to. */
  protected loadProfile(): void {
    const linkedId = this.auth.user()?.linkedId ?? null;
    if (linkedId === null) {
      this.profile.set(null);
      this.department.set(null);
      this.hospital.set(null);
      return;
    }
    const key: EntityKey = this.isDoctor() ? 'doctors' : 'patients';
    this.profileLoading.set(true);
    this.entities
      .get(key, linkedId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (individual) => {
          this.profile.set(individual);
          this.department.set(this.refOf(individual.relations['department']));
          const direct = this.refOf(individual.relations['hospital']);
          if (direct) this.hospital.set(direct);
          this.profileLoading.set(false);
          this.loadDepartmentHospital();
        },
        error: () => {
          this.profileLoading.set(false);
        },
      });
  }

  /** A doctor is only linked to a department: the hospital comes through it. */
  private loadDepartmentHospital(): void {
    const department = this.department();
    if (department === null || this.hospital() !== null) return;
    this.entities
      .get('departments', department.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (individual) => this.hospital.set(this.refOf(individual.relations['hospital'])),
        error: () => this.hospital.set(null),
      });
  }

  protected loadCounts(): void {
    this.countsLoading.set(true);
    this.entities
      .list('patients', { pageSize: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.patientTotal.set(page.total);
          this.countsLoading.set(false);
        },
        error: () => {
          this.patientTotal.set(null);
          this.countsLoading.set(false);
        },
      });
  }

  /**
   * Prescriptions of the doctor's own patients. The API scopes the collection,
   * so what comes back is exactly the doctor's list; only the *result* filter is
   * applied here because the REST layer offers no filter for an empty value.
   */
  protected loadTests(): void {
    this.testsLoading.set(true);
    this.testsFailed.set(false);
    this.entities
      .list('tests', { pageSize: 100, sort: 'date', order: 'desc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.testItems.set(page.items);
          this.testsLoading.set(false);
        },
        error: () => {
          this.testsLoading.set(false);
          this.testsFailed.set(true);
        },
      });
  }

  protected loadDirectory(): void {
    this.directoryLoading.set(true);
    this.directoryFailed.set(false);
    this.entities
      .list('doctors', { pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.doctorItems.set(page.items);
          this.doctorTotal.set(page.total);
        },
        error: () => {
          this.doctorItems.set(EMPTY_PAGE.items);
          this.doctorTotal.set(null);
          this.directoryFailed.set(true);
          this.directoryLoading.set(false);
        },
        complete: () => this.loadDirectoryDepartments(),
      });
  }

  private loadDirectoryDepartments(): void {
    if (this.directoryFailed()) {
      this.directoryLoading.set(false);
      return;
    }
    this.entities
      .list('departments', { pageSize: 100, sort: 'label', order: 'asc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page: Page<Individual>) => {
          this.departmentItems.set(page.items);
          this.directoryLoading.set(false);
        },
        error: () => {
          this.departmentItems.set(EMPTY_PAGE.items);
          this.directoryLoading.set(false);
          this.directoryFailed.set(true);
        },
      });
  }

  // --- writes --------------------------------------------------------------------

  /** `status` is writable for DOCTOR and RECEPTIONIST; nobody else reaches here. */
  readonly canWriteStatus = computed(() => {
    if (!this.auth.can('appointments', 'update')) return false;
    const writable = this.auth.editableFields('appointments');
    return writable === null || writable.includes('status');
  });

  protected canCreate(key: EntityKey): boolean {
    return this.auth.can(key, 'create');
  }

  /** True while a write is in flight for this very appointment row. */
  protected isBusyRow(id: string): boolean {
    const busy = this.busyId();
    return busy !== null && busy.startsWith(`${id}-`);
  }

  protected statusItems(current: string): DropdownItem[] {
    return APPOINTMENT_STATUSES.map((status) => ({
      id: status,
      label: this.statusLabel(status),
      icon: this.statusIcon(status),
      disabled: status === current,
      danger: status === 'Cancelled',
    }));
  }

  protected onStatusChange(slot: AppointmentSlot, item: DropdownItem): void {
    void this.setStatus(slot, item.id);
  }

  /** PATCH the status through the entity API, then refresh the sections that show it. */
  protected setStatus(slot: AppointmentSlot, status: string): void {
    if (status === slot.status) return;
    const body: EntityInput = { status };
    this.busyId.set(`${slot.id}-${status}`);
    this.entities
      .update('appointments', slot.id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.busyId.set(null);
          this.replaceItem(saved);
          if (!this.isDoctor()) this.loadPending();
          this.toast.success(
            this.translate.instant('staff.day.toast.statusTitle'),
            this.translate.instant('staff.day.toast.statusBody', {
              patient: this.patientName(slot),
              status: this.statusLabel(status),
            }),
          );
        },
        error: (error: HttpErrorResponse) => {
          this.busyId.set(null);
          this.toast.fromProblem(error);
        },
      });
  }

  private replaceItem(saved: Individual): void {
    this.windowItems.update((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    this.pendingItems.update((items) => items.map((item) => (item.id === saved.id ? saved : item)));
  }

  // --- navigation ----------------------------------------------------------------

  protected go(path: string, query: Record<string, string> = {}): void {
    void this.router.navigate([path], { queryParams: query });
  }

  protected createQuery(): Record<string, string> {
    return { create: '1' };
  }

  protected searchQuery(term: string): Record<string, string> {
    return { q: term };
  }

  protected patientLink(slot: AppointmentSlot): string[] {
    const patient = slot.patient;
    return patient ? ['/records/patients', patient.id] : ['/records/appointments', slot.id];
  }

  protected patientName(slot: AppointmentSlot): string {
    const patient = slot.patient;
    return patient ? patient.label : this.translate.instant('staff.day.noPatient');
  }

  // --- labels --------------------------------------------------------------------

  protected heading(): string {
    return this.auth.user()?.fullName ?? this.translate.instant('staff.day.title');
  }

  protected roleLabel(): string {
    return this.translate.instant(this.isDoctor() ? 'staff.day.roleDoctor' : 'staff.day.roleReceptionist');
  }

  protected subtitle(): string {
    const parts = [this.roleLabel()];
    const department = this.departmentName();
    if (department) parts.push(department);
    const hospital = this.hospitalName();
    if (hospital) parts.push(hospital);
    return parts.join(' · ');
  }

  protected todaySubtitle(): string | null {
    const count = this.todaySlots().length;
    if (count === 0) return this.translate.instant('staff.day.doctor.today.subtitleEmpty');
    return this.translate.instant('staff.day.doctor.today.subtitle', { count });
  }

  protected weekSubtitle(): string | null {
    return this.translate.instant('staff.day.doctor.week.subtitle', {
      patients: this.patientTotal() ?? 0,
      count: this.slots().length,
    });
  }

  protected testsSubtitle(): string | null {
    return this.translate.instant('staff.day.doctor.tests.subtitle', { count: this.pendingTests().length });
  }

  protected queueSubtitle(): string | null {
    return this.translate.instant('staff.day.reception.queue.subtitle', { count: this.todaySlots().length });
  }

  protected pendingSubtitle(): string | null {
    return this.translate.instant('staff.day.reception.pending.subtitle', { count: this.pendingSlots().length });
  }

  protected directoryCountLabel(items: Individual[]): string {
    return this.translate.instant('staff.day.reception.directoryCount', { count: items.length });
  }

  protected departmentDetail(): string | null {
    const profile = this.profile();
    if (profile === null || !this.isDoctor()) return null;
    const license = profile.fields['licenseNumber'];
    return typeof license === 'string' && license.length > 0 ? license : null;
  }

  protected errorMessage(): string {
    return this.translate.instant('staff.day.errorLoad');
  }

  protected changeStatusLabel(): string {
    return this.translate.instant('staff.day.changeStatus');
  }

  protected statusLabel(status: string): string {
    return labelOf(this.translate, `staff.day.status.${this.slug(status)}`, status);
  }

  protected timeText(value: string): string {
    const at = timeOf(value);
    if (at === 0) return this.translate.instant('common.notSet');
    return new Intl.DateTimeFormat(this.locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  }

  protected dayText(value: string): string {
    return formatDate(value, this.lang());
  }

  protected dayHeading(day: Date): string {
    const today = startOfDay();
    const tomorrow = addDays(today, 1);
    const key = toDateOnly(day);
    if (key === toDateOnly(today)) return this.translate.instant('common.today');
    if (key === toDateOnly(tomorrow)) return this.translate.instant('common.tomorrow');
    return formatDate(`${key}T12:00:00`, this.lang());
  }

  protected testDate(test: Individual): string {
    return this.dayText(this.fieldText(test, 'date'));
  }

  protected testTypeLabel(test: Individual): string {
    const type = test.types.find((candidate) => candidate !== 'MedicalTest') ?? '';
    return type.length > 0 ? labelOf(this.translate, `entities.values.${type}`, type) : '';
  }

  protected testPatient(test: Individual): Ref | null {
    return this.refOf(test.relations['patient']);
  }

  protected specialtyOf(doctor: Individual): string | null {
    const specialty = doctor.types.find((type) => type !== 'Doctor') ?? null;
    return specialty === null ? null : labelOf(this.translate, `entities.values.${specialty}`, specialty);
  }

  protected departmentOf(doctor: Individual): string | null {
    return this.refOf(doctor.relations['department'])?.label ?? null;
  }

  protected hospitalOf(department: Individual): string | null {
    return this.refOf(department.relations['hospital'])?.label ?? null;
  }

  private isPendingResult(test: Individual): boolean {
    const raw = this.fieldText(test, 'result').trim().toLowerCase().replace(/[\s.-]+/g, '');
    return raw.length === 0 || PENDING_RESULTS.includes(raw);
  }

  private fieldText(item: Individual, field: string): string {
    const value = item.fields[field];
    return value === null || value === undefined ? '' : String(value);
  }

  private refOf(value: Ref | Ref[] | null | undefined): Ref | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  }

  private statusIcon(status: string): IconName {
    const key = this.slug(status);
    if (key === 'pending') return 'clock';
    if (key === 'confirmed') return 'circle-check';
    if (key === 'completed') return 'check';
    if (key === 'cancelled') return 'circle-x';
    return 'tag';
  }

  private slug(value: string): string {
    const cleaned = (value ?? '').trim().toLowerCase().replace(/[^a-z]+/g, '');
    return cleaned.length > 0 ? cleaned : 'unknown';
  }

  private lang(): string {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }

  private locale(): string {
    return this.lang() === 'fr' ? 'fr-FR' : 'en-GB';
  }
}
