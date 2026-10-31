import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EntitiesService } from '../../core/api/entity.service';
import type { EntityInput, Individual, Page, Ref } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/toast/toast.service';
import { downloadText } from '../../core/util/csv';
import { formatDate, relativeTime } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import { UiAvatarComponent } from '../../shared/ui/avatar/ui-avatar.component';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
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

/** One knowledge entry paired with the symptoms the store links to it. */
interface HealthTip {
  id: string;
  label: string;
  category: string | null;
  symptoms: Ref[];
}

/** A portal shortcut: the label keys live in `patient.dashboard.*`. */
interface QuickAction {
  path: string;
  icon: 'plus' | 'file-text' | 'bot';
  labelKey: string;
  hintKey: string;
}

/**
 * Landing page of the patient portal: a warm greeting, the next visit, the
 * doctors and conditions the person is followed for, the latest results and
 * three reading tips taken from the knowledge base.
 *
 * Every read is scoped by the API itself: for a patient token the list
 * endpoints only ever return that patient's own records, so no filter has to be
 * trusted here and no permission is worked around.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'app-patient-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiConfirmDialogComponent,
    UiEmptyStateComponent,
    UiIconComponent,
    UiSkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page portal">
      <header class="greet">
        <div class="greet__text">
          <p class="greet__eyebrow">{{ greetingKey() | translate }}</p>
          <h1 class="greet__title">{{ 'patient.dashboard.hello' | translate: { name: firstName() } }}</h1>
          <p class="greet__lede">{{ 'patient.dashboard.lede' | translate }}</p>
        </div>
        <div class="greet__side">
          <ui-button variant="secondary" icon="plus" (click)="go(paths.request)">
            {{ 'patient.dashboard.actionRequest' | translate }}
          </ui-button>
        </div>
      </header>

      @if (!hasLinkedPatient()) {
        <ui-card elevated>
          <ui-empty-state
            icon="user"
            [title]="'patient.dashboard.noProfileTitle' | translate"
            [hint]="'patient.dashboard.noProfileHint' | translate"
          >
            <p class="support">{{ 'patient.dashboard.noProfileSupport' | translate }}</p>
          </ui-empty-state>
        </ui-card>
      } @else {
        @if (loadError()) {
          <div class="banner banner--error" role="alert">
            <ui-icon name="triangle-alert" size="18" />
            <div class="banner__text">
              <p class="banner__title">{{ 'patient.dashboard.partialError' | translate }}</p>
              <p class="banner__detail">{{ loadError() }}</p>
            </div>
            <ui-button variant="outline" size="sm" icon="refresh" (click)="load()">
              {{ 'common.retry' | translate }}
            </ui-button>
          </div>
        }

        <section class="hero" aria-labelledby="hero-title">
          <h2 id="hero-title" class="visually-hidden">{{ 'patient.dashboard.nextVisit' | translate }}</h2>

          @if (loadingVisit()) {
            <div class="hero__skeleton">
              <ui-skeleton height="1.25rem" width="45%" />
              <ui-skeleton height="2.5rem" width="70%" />
              <ui-skeleton height="1rem" width="55%" />
            </div>
          } @else {
            @if (nextVisit(); as visit) {
              <div class="hero__grid">
                <div class="hero__main">
                  <p class="hero__eyebrow">{{ 'patient.dashboard.nextVisit' | translate }}</p>
                  <h3 class="hero__when">
                    {{ relative(visit) }}
                    <span class="hero__absolute">{{ dayLabel(visit) }}</span>
                  </h3>
                  <ul class="hero__facts">
                    <li>
                      <ui-icon name="building" size="16" />
                      <span>{{ departmentLabel(visit) }}</span>
                    </li>
                    <li>
                      <ui-icon name="clock" size="16" />
                      <span>{{ timeLabel(visit) }}</span>
                    </li>
                    @if (doctorLabel(visit); as doctor) {
                      <li>
                        <ui-icon name="stethoscope" size="16" />
                        <span>{{ doctor }}</span>
                      </li>
                    }
                    @if (hospitalLabel(visit); as hospital) {
                      <li>
                        <ui-icon name="hospital" size="16" />
                        <span>{{ hospital }}</span>
                      </li>
                    }
                  </ul>
                  <div class="hero__actions">
                    <ui-button variant="secondary" icon="calendar" (click)="addToCalendar(visit)">
                      {{ 'patient.dashboard.addToCalendar' | translate }}
                    </ui-button>
                    <ui-button variant="outline" icon="x" [disabled]="!mayCancel(visit)" (click)="askCancel(visit)">
                      {{ 'patient.dashboard.cancelVisit' | translate }}
                    </ui-button>
                    <ui-button variant="ghost" (click)="go(paths.appointments)">
                      {{ 'patient.dashboard.allVisits' | translate }}
                    </ui-button>
                  </div>
                  @if (!mayCancel(visit)) {
                    <p class="hero__note">{{ 'patient.dashboard.cancelNotOpen' | translate }}</p>
                  }
                </div>
                <div class="hero__aside">
                  <ui-badge kind="status" [status]="statusOf(visit)" [label]="statusLabel(statusOf(visit))" />
                  @if (typeOf(visit); as visitType) {
                    <ui-badge kind="info" [label]="typeLabel(visitType)" />
                  }
                  <p class="hero__hint">{{ cancelHint() }}</p>
                </div>
              </div>
            } @else {
              <div class="hero__empty">
                <ui-icon name="calendar" size="28" />
                <p class="hero__empty-title">{{ 'patient.dashboard.noVisitTitle' | translate }}</p>
                <p class="hero__empty-hint">{{ 'patient.dashboard.noVisitHint' | translate }}</p>
                <div class="hero__actions">
                  <ui-button icon="plus" (click)="go(paths.request)">
                    {{ 'patient.dashboard.actionRequest' | translate }}
                  </ui-button>
                  <ui-button variant="ghost" (click)="go(paths.doctors)">
                    {{ 'patient.dashboard.actionFindDoctor' | translate }}
                  </ui-button>
                </div>
              </div>
            }
          }
        </section>

        <nav class="quick" [attr.aria-label]="'patient.dashboard.quickActions' | translate">
          @for (action of quickActions(); track action.path) {
            <a class="quick__item" [routerLink]="action.path">
              <ui-icon [name]="action.icon" size="20" />
              <span class="quick__label">{{ action.labelKey | translate }}</span>
              <span class="quick__hint">{{ action.hintKey | translate }}</span>
            </a>
          }
        </nav>

        <div class="blocks">
          <ui-card elevated [title]="'patient.dashboard.myDoctors' | translate" icon="stethoscope">
            @if (loadingProfile()) {
              <div class="stack-sm">
                @for (row of rows(2); track row) {
                  <ui-skeleton height="4.5rem" radius="var(--radius-input)" />
                }
              </div>
            } @else if (doctors().length === 0) {
              <p class="muted">{{ 'patient.dashboard.myDoctorsEmpty' | translate }}</p>
            } @else {
              <ul class="docs">
                @for (doctor of doctors(); track doctor.id) {
                  <li class="doc">
                    <ui-avatar [name]="doctor.label" size="md" role="DOCTOR" />
                    <div class="doc__text">
                      <p class="doc__name">{{ doctor.label }}</p>
                      @if (specialtyOf(doctor); as specialty) {
                        <ui-badge kind="info" [label]="specialtyLabel(specialty)" />
                      }
                      <p class="doc__meta">{{ departmentOf(doctor) }}</p>
                    </div>
                    <a class="doc__link" [routerLink]="[paths.doctors]" [queryParams]="{ q: doctor.label }">
                      {{ 'patient.dashboard.viewProfile' | translate }}
                    </a>
                  </li>
                }
              </ul>
            }
          </ui-card>

          <ui-card
            elevated
            [title]="'patient.dashboard.myConditions' | translate"
            [subtitle]="conditionsSubtitle()"
            icon="heart"
          >
            <ng-template #actions>
              <a class="link" [routerLink]="paths.record">{{ 'patient.dashboard.openRecord' | translate }}</a>
            </ng-template>
            @if (loadingProfile()) {
              <div class="stack-sm">
                @for (row of rows(3); track row) {
                  <ui-skeleton height="2rem" width="60%" radius="var(--radius-pill)" />
                }
              </div>
            } @else if (conditions().length === 0) {
              <p class="muted">{{ 'patient.dashboard.myConditionsEmpty' | translate }}</p>
            } @else {
              <ul class="chips">
                @for (condition of conditions(); track condition.id) {
                  <li>
                    <a
                      class="chip-link"
                      [routerLink]="paths.library"
                      [queryParams]="{ q: condition.label, family: 'diseases' }"
                    >
                      {{ condition.label }}
                    </a>
                  </li>
                }
              </ul>
              <p class="footnote">{{ 'patient.dashboard.conditionsFootnote' | translate }}</p>
            }
          </ui-card>

          <ui-card elevated [title]="'patient.dashboard.latestTests' | translate" icon="flask">
            <ng-template #actions>
              <a class="link" [routerLink]="paths.record">{{ 'patient.dashboard.allResults' | translate }}</a>
            </ng-template>
            @if (loadingTests()) {
              <div class="stack-sm">
                @for (row of rows(3); track row) {
                  <ui-skeleton height="5rem" radius="var(--radius-input)" />
                }
              </div>
            } @else if (recentTests().length === 0) {
              <p class="muted">{{ 'patient.dashboard.latestTestsEmpty' | translate }}</p>
            } @else {
              <ul class="tests">
                @for (test of recentTests(); track test.id) {
                  <li class="test">
                    <div class="test__head">
                      <ui-badge kind="info" [label]="testTypeLabel(test)" />
                      <span class="test__date">{{ dayLabel(test) }}</span>
                    </div>
                    <p class="test__label">{{ test.label }}</p>
                    <p class="test__result">{{ resultOf(test) }}</p>
                  </li>
                }
              </ul>
            }
          </ui-card>

          <ui-card
            class="block-wide"
            elevated
            [title]="'patient.dashboard.tips' | translate"
            [subtitle]="'patient.dashboard.tipsSubtitle' | translate"
            icon="book"
          >
            @if (loadingTips()) {
              <div class="stack-sm">
                @for (row of rows(3); track row) {
                  <ui-skeleton height="7rem" radius="var(--radius-card)" />
                }
              </div>
            } @else if (tips().length === 0) {
              <p class="muted">{{ 'patient.dashboard.tipsEmpty' | translate }}</p>
            } @else {
              <ul class="tips">
                @for (tip of tips(); track tip.id) {
                  <li class="tip">
                    <h3 class="tip__title">{{ tip.label }}</h3>
                    @if (tip.category) {
                      <ui-badge kind="neutral" [label]="categoryLabel(tip.category)" />
                    }
                    @if (tip.symptoms.length > 0) {
                      <p class="tip__sub">{{ 'patient.dashboard.tipsSymptoms' | translate }}</p>
                      <ul class="tip__list">
                        @for (symptom of tip.symptoms; track symptom.id) {
                          <li>
                            <a [routerLink]="paths.library" [queryParams]="{ q: symptom.label, family: 'symptoms' }">
                              {{ symptom.label }}
                            </a>
                          </li>
                        }
                      </ul>
                    }
                    <a class="tip__link" [routerLink]="paths.library" [queryParams]="{ q: tip.label, family: 'diseases' }">
                      {{ 'patient.dashboard.tipsReadMore' | translate }}
                    </a>
                  </li>
                }
              </ul>
              <p class="footnote">{{ 'patient.dashboard.tipsFootnote' | translate }}</p>
            }
          </ui-card>
        </div>
      }

      <ui-confirm-dialog
        [open]="cancelOpen()"
        [title]="'patient.dashboard.cancelDialogTitle' | translate"
        [message]="cancelDialogMessage()"
        [confirmLabel]="'patient.dashboard.cancelDialogConfirm' | translate"
        [busy]="cancelling()"
        (openChange)="onCancelOpenChange($event)"
        (confirmed)="confirmCancel()"
      />

      @if (cancelBlocked()) {
        <div class="banner banner--info" role="status">
          <ui-icon name="info" size="18" />
          <div class="banner__text">
            <p class="banner__title">{{ 'patient.dashboard.cancelBlockedTitle' | translate }}</p>
            <p class="banner__detail">{{ 'patient.dashboard.cancelBlockedHint' | translate }}</p>
          </div>
          <ui-button variant="ghost" size="sm" (click)="cancelBlocked.set(false)">
            {{ 'common.close' | translate }}
          </ui-button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .portal {
        display: flex;
        flex-direction: column;
        gap: var(--sp-5);
      }
      .greet {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--sp-4);
        flex-wrap: wrap;
      }
      .greet__eyebrow {
        margin: 0 0 var(--sp-2);
        font-size: var(--fs-sm);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--secondary);
      }
      .greet__title {
        margin: 0;
        font-size: var(--fs-3xl);
        line-height: 1.2;
      }
      .greet__lede {
        margin: var(--sp-2) 0 0;
        max-width: 60ch;
        font-size: var(--fs-md);
        color: var(--text-muted);
      }
      .hero {
        padding: var(--sp-5);
        color: #fff;
        background: var(--gradient-banner);
        border: 0;
        border-radius: calc(var(--radius-card) + 4px);
        box-shadow: var(--shadow-md);
      }
      .hero__grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-5);
        align-items: flex-start;
      }
      .hero__main {
        flex: 1 1 320px;
        min-width: 0;
      }
      .hero__aside {
        flex: 1 1 180px;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        align-items: flex-start;
      }
      .hero__eyebrow {
        margin: 0 0 var(--sp-1);
        font-size: var(--fs-sm);
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgb(255 255 255 / 78%);
      }
      .hero__when {
        margin: 0 0 var(--sp-3);
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        font-size: var(--fs-2xl);
        color: #fff;
      }
      .hero__absolute {
        font-size: var(--fs-md);
        font-weight: 500;
        color: rgb(255 255 255 / 82%);
      }
      .hero__facts {
        margin: 0 0 var(--sp-4);
        padding: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2) var(--sp-4);
      }
      .hero__facts li {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        margin: 0;
        font-size: var(--fs-md);
        color: rgb(255 255 255 / 90%);
      }
      .hero__facts ui-icon {
        color: rgb(255 255 255 / 84%);
      }
      .hero__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .hero__note,
      .hero__hint {
        margin: var(--sp-2) 0 0;
        font-size: var(--fs-sm);
        color: rgb(255 255 255 / 82%);
      }
      .hero__empty {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        align-items: flex-start;
      }
      .hero__empty ui-icon {
        color: rgb(255 255 255 / 88%);
      }
      .hero__empty-title {
        margin: 0;
        color: #fff;
        font-size: var(--fs-lg);
        font-weight: 650;
      }
      .hero__empty-hint {
        margin: 0 0 var(--sp-2);
        font-size: var(--fs-md);
        color: rgb(255 255 255 / 82%);
      }
      .hero__skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .quick {
        display: grid;
        gap: var(--sp-3);
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      }
      .quick__item {
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
        transition:
          border-color var(--duration) var(--ease),
          box-shadow var(--duration) var(--ease);
      }
      .quick__item:hover {
        text-decoration: none;
        border-color: var(--secondary);
        box-shadow: var(--shadow-md);
      }
      .quick__item ui-icon {
        grid-row: span 2;
        color: var(--accent);
      }
      .quick__label {
        font-size: var(--fs-md);
        font-weight: 650;
      }
      .quick__hint {
        grid-column: 2;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .blocks {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
      }
      .block-wide {
        grid-column: 1 / -1;
      }
      .muted {
        margin: 0;
        font-size: var(--fs-md);
        color: var(--text-muted);
      }
      .docs {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .doc {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--sp-3);
        align-items: center;
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .doc__text {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        min-width: 0;
      }
      .doc__name {
        margin: 0;
        font-size: var(--fs-md);
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .doc__meta,
      .footnote {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .doc__link {
        font-size: var(--fs-sm);
        font-weight: 600;
        white-space: nowrap;
      }
      .chips {
        margin: 0 0 var(--sp-3);
        padding: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .chip-link {
        display: inline-flex;
        align-items: center;
        padding: var(--sp-2) var(--sp-3);
        font-size: var(--fs-md);
        background: var(--secondary-soft);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        color: var(--text);
        text-decoration: none;
      }
      .chip-link:hover {
        text-decoration: none;
        border-color: var(--secondary);
        color: var(--secondary);
      }
      .tests {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .test {
        padding: var(--sp-3);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-inline-start: 4px solid var(--info-500);
        border-radius: var(--radius-input);
      }
      .test__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
      }
      .test__date {
        font-size: var(--fs-sm);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .test__label {
        margin: var(--sp-2) 0 var(--sp-1);
        font-size: var(--fs-md);
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .test__result {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .tips {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
      }
      .tip {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding: var(--sp-4);
        background: var(--accent-soft);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }
      .tip__title {
        margin: 0;
        font-size: var(--fs-lg);
      }
      .tip__sub {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        font-weight: 650;
        color: var(--text-muted);
      }
      .tip__list {
        margin: 0;
        padding: 0 0 0 var(--sp-4);
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        font-size: var(--fs-md);
      }
      .tip__link {
        margin-block-start: var(--sp-1);
        font-size: var(--fs-sm);
        font-weight: 650;
      }
      .link {
        font-size: var(--fs-sm);
        font-weight: 600;
      }
      .support {
        margin: var(--sp-2) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .banner {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-3);
        padding: var(--sp-4);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }
      .banner--error {
        background: var(--danger-50);
        border-color: var(--danger-100);
      }
      .banner--info {
        background: var(--info-50);
        border-color: var(--info-100);
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
      @media (max-width: 640px) {
        .hero {
          padding: var(--sp-4);
        }
        .greet__title {
          font-size: var(--fs-2xl);
        }
        .doc {
          grid-template-columns: auto 1fr;
        }
        .doc__link {
          grid-column: 2;
        }
      }
    `,
  ],
})
export class PatientDashboardComponent implements OnInit {
  /** Mounted by the portal shell under /patient/*. */
  readonly paths = {
    request: '/patient/request',
    appointments: '/patient/appointments',
    doctors: '/patient/doctors',
    library: '/patient/library',
    record: '/patient/record',
  } as const;

  private readonly entities = inject(EntitiesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  private cancelId: string | null = null;

  readonly profile = signal<Individual | null>(null);
  readonly doctors = signal<Individual[]>([]);
  readonly conditions = signal<Individual[]>([]);
  readonly recentTests = signal<Individual[]>([]);
  readonly nextVisit = signal<Individual | null>(null);
  readonly tips = signal<HealthTip[]>([]);

  readonly loadingProfile = signal(true);
  readonly loadingVisit = signal(true);
  readonly loadingTests = signal(true);
  readonly loadingTips = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly cancelOpen = signal(false);
  readonly cancelling = signal(false);
  readonly cancelBlocked = signal(false);

  readonly patientId = computed<string | null>(() => this.auth.user()?.linkedId ?? null);
  readonly hasLinkedPatient = computed<boolean>(() => this.patientId() !== null);

  readonly firstName = computed<string>(() => {
    const full = (this.auth.user()?.fullName ?? '').trim();
    const first = full.split(/\s+/)[0] ?? '';
    return first.length > 0 ? first : this.translate.instant('patient.dashboard.friend');
  });

  readonly greetingKey = computed<string>(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'patient.dashboard.greetingMorning';
    if (hour < 18) return 'patient.dashboard.greetingAfternoon';
    return 'patient.dashboard.greetingEvening';
  });

  readonly conditionsSubtitle = computed<string>(() =>
    this.translate.instant('patient.dashboard.myConditionsCount', { count: this.conditions().length }),
  );

  /** The status wording of the open visit, taken from the stored status only. */
  readonly cancelHint = computed<string>(() => {
    const status = this.statusOf(this.nextVisit()).toLowerCase();
    if (status === 'pending') return this.translate.instant('patient.dashboard.hintPending');
    if (status === 'confirmed') return this.translate.instant('patient.dashboard.hintConfirmed');
    return this.translate.instant('patient.dashboard.hintGeneric');
  });

  readonly quickActions = computed<QuickAction[]>(() => [
    {
      path: this.paths.request,
      icon: 'plus',
      labelKey: 'patient.dashboard.actionRequest',
      hintKey: 'patient.dashboard.actionRequestHint',
    },
    {
      path: this.paths.record,
      icon: 'file-text',
      labelKey: 'patient.dashboard.actionRecord',
      hintKey: 'patient.dashboard.actionRecordHint',
    },
    {
      path: '/patient/assistant',
      icon: 'bot',
      labelKey: 'patient.dashboard.actionAssistant',
      hintKey: 'patient.dashboard.actionAssistantHint',
    },
  ]);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const id = this.patientId();
    this.loadError.set(null);
    if (!id) {
      this.loadingProfile.set(false);
      this.loadingVisit.set(false);
      this.loadingTests.set(false);
      this.loadingTips.set(false);
      return;
    }
    this.readProfile(id);
    this.readNextVisit();
    this.readLatestTests();
  }

  protected go(path: string): void {
    void this.router.navigate([path]);
  }

  protected rows(count: number): number[] {
    return Array.from({ length: count }, (_unused, index) => index);
  }

  // --- reads -------------------------------------------------------------------

  /**
   * Each block loads on its own and keeps its own skeleton: a slow or refused
   * endpoint must not blank out the whole portal, failures land in one retry
   * banner instead.
   */
  private readProfile(id: string): void {
    this.loadingProfile.set(true);
    this.entities.get('patients', id).subscribe({
      next: (patient) => {
        this.profile.set(patient);
        this.loadingProfile.set(false);
        this.loadDoctors(id);
        this.loadConditions(id);
      },
      error: (error: HttpErrorResponse) => {
        this.loadingProfile.set(false);
        this.fail(error);
      },
    });
  }

  private loadDoctors(id: string): void {
    this.entities
      .list('doctors', { patient: id, pageSize: 20, sort: 'label', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => this.doctors.set(page.items));
  }

  private loadConditions(id: string): void {
    this.entities
      .list('diseases', { patient: id, pageSize: 50, sort: 'label', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe((page) => {
        this.conditions.set(page.items);
        this.buildTips(page.items);
      });
  }

  private readNextVisit(): void {
    this.loadingVisit.set(true);
    this.entities
      .list('appointments', { upcoming: true, pageSize: 4, sort: 'date', order: 'asc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe({
        next: (page) => {
          const open = page.items.find((item) => this.isOpenStatus(this.statusOf(item)));
          this.nextVisit.set(open ?? page.items[0] ?? null);
          this.loadingVisit.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.loadingVisit.set(false);
          this.fail(error);
        },
      });
  }

  private readLatestTests(): void {
    this.loadingTests.set(true);
    this.entities
      .list('tests', { pageSize: 3, sort: 'date', order: 'desc' })
      .pipe(catchError(() => of(EMPTY_PAGE)))
      .subscribe({
        next: (page) => {
          this.recentTests.set(page.items.slice(0, 3));
          this.loadingTests.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.loadingTests.set(false);
          this.fail(error);
        },
      });
  }

  /** Three tips, in the stable alphabetical order of the patient's own conditions. */
  private buildTips(conditions: Individual[]): void {
    this.loadingTips.set(true);
    this.tips.set(
      conditions.slice(0, 3).map((condition) => ({
        id: condition.id,
        label: condition.label,
        category: condition.types.find((type) => type.endsWith('Disease')) ?? null,
        symptoms: this.refsOf(condition.relations['symptoms']),
      })),
    );
    this.loadingTips.set(false);
  }

  private fail(error: HttpErrorResponse): void {
    this.loadingProfile.set(false);
    this.loadingVisit.set(false);
    this.loadingTests.set(false);
    this.loadingTips.set(false);
    this.loadError.set(error.message || this.translate.instant('errors.UNKNOWN'));
  }

  // --- labels --------------------------------------------------------------------

  protected statusOf(item: Individual | null): string {
    const value = item?.fields['status'];
    return typeof value === 'string' ? value : '';
  }

  protected typeOf(item: Individual): string | null {
    return item.types.find((type) => type !== 'MedicalAppointment' && type !== 'NamedIndividual') ?? null;
  }

  protected specialtyOf(doctor: Individual): string | null {
    return doctor.types.find((type) => type !== 'Doctor' && type !== 'NamedIndividual') ?? null;
  }

  protected isOpenStatus(status: string): boolean {
    const key = status.toLowerCase();
    return key === 'pending' || key === 'confirmed' || key === 'scheduled';
  }

  protected statusLabel(status: string): string {
    return labelOf(this.translate, `patient.shared.status.${this.slug(status)}`, status);
  }

  protected typeLabel(type: string): string {
    return labelOf(this.translate, `patient.shared.appointmentType.${this.slug(type)}`, type);
  }

  protected specialtyLabel(specialty: string): string {
    return labelOf(this.translate, `patient.shared.specialty.${this.slug(specialty)}`, specialty);
  }

  protected categoryLabel(category: string): string {
    return labelOf(this.translate, `patient.shared.diseaseCategory.${this.slug(category)}`, category);
  }

  protected testTypeLabel(test: Individual): string {
    const type = test.types.find((item) => item !== 'MedicalTest' && item !== 'NamedIndividual') ?? '';
    return labelOf(this.translate, `patient.shared.testType.${this.slug(type)}`, type);
  }

  protected departmentLabel(item: Individual): string {
    const ref = this.singleRef(item.relations['department']);
    return ref?.label ?? this.translate.instant('patient.dashboard.factNoDepartment');
  }

  /**
   * An appointment is stored against a department, never against a doctor, so the
   * doctor named here is the patient's own doctor who works in that department.
   */
  protected doctorLabel(item: Individual): string | null {
    const department = this.singleRef(item.relations['department']);
    if (!department) return null;
    const mine = this.doctors()
      .filter((doctor) => this.singleRef(doctor.relations['department'])?.id === department.id)
      .map((doctor) => doctor.label);
    return mine.length > 0 ? mine.join(` ${this.translate.instant('common.and')} `) : null;
  }

  protected hospitalLabel(item: Individual): string | null {
    const department = this.singleRef(item.relations['department']);
    if (!department) return null;
    const followed = this.doctors().some(
      (doctor) => this.singleRef(doctor.relations['department'])?.id === department.id,
    );
    if (!followed) return null;
    return this.singleRef(this.profile()?.relations['hospital'])?.label ?? null;
  }

  protected departmentOf(doctor: Individual): string {
    const ref = this.singleRef(doctor.relations['department']);
    if (ref) return ref.label;
    const specialty = this.specialtyOf(doctor);
    return specialty
      ? this.specialtyLabel(specialty)
      : this.translate.instant('patient.dashboard.factNoDepartment');
  }

  protected resultOf(test: Individual): string {
    const value = test.fields['result'];
    return typeof value === 'string' && value.length > 0 ? value : this.translate.instant('patient.shared.noResult');
  }

  protected dayLabel(item: Individual): string {
    return formatDate(this.dateOf(item), this.lang());
  }

  protected timeLabel(item: Individual): string {
    const date = new Date(this.dateOf(item));
    if (Number.isNaN(date.getTime())) return this.translate.instant('patient.shared.noDate');
    return new Intl.DateTimeFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  protected relative(item: Individual): string {
    return relativeTime(this.dateOf(item), this.lang());
  }

  private singleRef(value: Ref[] | Ref | null | undefined): Ref | null {
    if (value === null || value === undefined) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  private refsOf(value: Ref[] | Ref | null | undefined): Ref[] {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }

  private dateOf(item: Individual | null): string {
    const value = item?.fields['date'];
    return typeof value === 'string' ? value : '';
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

  // --- cancellation ---------------------------------------------------------------

  /** Only an open visit that belongs to this account can be cancelled here. */
  protected mayCancel(item: Individual | null): boolean {
    if (!item || !this.isOpenStatus(this.statusOf(item))) return false;
    const owner = this.singleRef(item.relations['patient']);
    return owner === null || owner.id === this.patientId();
  }

  protected askCancel(item: Individual): void {
    this.cancelId = item.id;
    this.cancelBlocked.set(false);
    this.cancelOpen.set(true);
  }

  protected onCancelOpenChange(open: boolean): void {
    this.cancelOpen.set(open);
    if (!open) this.cancelling.set(false);
  }

  protected cancelDialogMessage(): string {
    const item = this.findVisit(this.cancelId);
    if (!item) return this.translate.instant('patient.dashboard.cancelDialogFallback');
    return this.translate.instant('patient.dashboard.cancelDialogBody', {
      when: `${formatDate(this.dateOf(item), this.lang())} · ${this.timeLabel(item)}`,
      where: this.departmentLabel(item),
    });
  }

  /** Public for the specs and for the confirmation flow. */
  confirmCancel(): void {
    const item = this.findVisit(this.cancelId);
    if (!item) {
      this.cancelOpen.set(false);
      return;
    }
    this.cancelling.set(true);
    // Confirming and cancelling a visit belong to the back office: when this
    // PATCH is refused with a 403 the portal explains it instead of insisting.
    const body: EntityInput = { status: 'Cancelled' };
    this.entities.update('appointments', item.id, body).subscribe({
      next: () => {
        this.cancelling.set(false);
        this.cancelOpen.set(false);
        this.cancelId = null;
        this.toast.success(
          this.translate.instant('patient.dashboard.cancelDoneTitle'),
          this.translate.instant('patient.dashboard.cancelDoneBody'),
        );
        this.readNextVisit();
      },
      error: () => {
        this.cancelling.set(false);
        this.cancelOpen.set(false);
        this.cancelBlocked.set(true);
      },
    });
  }

  private findVisit(id: string | null): Individual | null {
    if (!id) return null;
    const hero = this.nextVisit();
    return hero && hero.id === id ? hero : null;
  }

  // --- calendar file ---------------------------------------------------------------

  /** Client-side `.ics`: the portal never writes to the calendar of the clinic. */
  addToCalendar(item: Individual): void {
    const start = new Date(this.dateOf(item));
    if (Number.isNaN(start.getTime())) {
      this.toast.warning(
        this.translate.instant('patient.dashboard.icsBadTitle'),
        this.translate.instant('patient.dashboard.icsBadBody'),
      );
      return;
    }
    const end = new Date(start.getTime() + 30 * 60_000);
    const location = this.departmentLabel(item);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MedicCare//Patient Portal//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${item.id}@medicare`,
      `DTSTAMP:${this.icsStamp(new Date())}`,
      `DTSTART:${this.icsStamp(start)}`,
      `DTEND:${this.icsStamp(end)}`,
      `SUMMARY:${this.escIcs(`${this.translate.instant('patient.dashboard.icsSummaryPrefix')} ${location}`)}`,
      `LOCATION:${this.escIcs(location)}`,
      `DESCRIPTION:${this.escIcs(this.icsDescription(item))}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    downloadText(`${item.id}.ics`, `${lines.join('\r\n')}\r\n`, 'text/calendar;charset=utf-8');
    this.toast.success(
      this.translate.instant('patient.dashboard.icsDoneTitle'),
      this.translate.instant('patient.dashboard.icsDoneBody'),
    );
  }

  private icsDescription(item: Individual): string {
    const parts = [this.translate.instant('patient.dashboard.icsIntro'), this.statusLabel(this.statusOf(item))];
    const doctor = this.doctorLabel(item);
    if (doctor) parts.push(`${this.translate.instant('patient.dashboard.icsDoctor')}: ${doctor}`);
    parts.push(`${this.translate.instant('patient.dashboard.icsDepartment')}: ${this.departmentLabel(item)}`);
    return parts.join(' | ');
  }

  private icsStamp(value: Date): string {
    return `${value.toISOString().replace(/[-:]|\.\d{3}Z/g, '')}Z`;
  }

  /** RFC 5545 escaping: an unescaped comma or semicolon breaks the property. */
  private escIcs(value: string): string {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\r?\n/g, '\\n');
    return escaped.length > 200 ? `${escaped.slice(0, 197)}...` : escaped;
  }
}

