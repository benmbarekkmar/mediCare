import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import { Router } from '@angular/router';
import { merge } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiBadgeComponent, type BadgeKind } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiCardFooterDirective } from '../../shared/ui/card/ui-card-footer.directive';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiInputComponent } from '../../shared/ui/input/ui-input.component';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiRadioGroupComponent } from '../../shared/ui/radio/ui-radio-group.component';
import type { SelectOption } from '../../shared/ui/select/ui-select.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiStatCardComponent } from '../../shared/ui/stat-card/ui-stat-card.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { AccountService } from '../../core/api/account.service';
import { HealthService, type HealthPayload } from '../../core/api/insight.service';
import { OntologyService } from '../../core/api/ontology.service';
import type { OntologyStats } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { LangService } from '../../core/i18n/i18n';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/toast/toast.service';
import { formatDateTime } from '../../core/util/format';

/** `GET /status` as declared by `HealthService.status()`. */
interface EndpointInfo {
  readonly name: string;
  readonly version: string;
  readonly environment: string;
  readonly dataset: string;
  readonly sparql: { readonly ok: boolean };
}

interface EntityCountRow {
  readonly key: string;
  readonly value: number;
}

/** `currentPassword: min 4, max 200` and `newPassword: min 8, max 200 + letter + digit` mirror the backend zod schema. */
const passwordPolicy: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return /[A-Za-z]/.test(value) && /\d/.test(value) ? null : { password: true };
};

const matchesPassword: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  const current: unknown = control.parent?.get('next')?.value;
  return current === value ? null : { passwordMismatch: true };
};

/**
 * Settings for the back-office roles (ADMIN, DOCTOR, RECEPTIONIST): appearance,
 * own-password change, the current session and, for ADMIN only, the read-only
 * Fuseki health probe and the ontology census.
 */
@Component({
  selector: 'page-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslateModule,
    UiAlertComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiCardFooterDirective,
    UiErrorStateComponent,
    UiIconComponent,
    UiInputComponent,
    UiPageHeaderComponent,
    UiRadioGroupComponent,
    UiSkeletonComponent,
    UiStatCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <ui-page-header
        [title]="'settings.title' | translate"
        [subtitle]="'settings.subtitle' | translate"
        icon="settings"
        [back]="false"
      />

      <div class="stack">
        <ui-card
          [title]="'settings.appearance.title' | translate"
          [subtitle]="'settings.appearance.subtitle' | translate"
          icon="sliders"
        >
          <form class="stack" [formGroup]="preferencesForm" novalidate>
            <ui-radio-group
              formControlName="theme"
              name="settings-theme-mode"
              layout="row"
              [options]="themeOptions"
              [label]="'settings.appearance.theme'"
              [hint]="'settings.appearance.themeHint'"
            />
            <ui-radio-group
              formControlName="lang"
              name="settings-language"
              layout="row"
              [options]="languageOptions"
              [label]="'settings.appearance.language'"
              [hint]="'settings.appearance.languageHint'"
            />
            <p class="hint">
              <ui-icon name="check" size="14" />
              <span>{{ 'settings.appearance.applied' | translate }}</span>
            </p>
          </form>
        </ui-card>

        <ui-card [title]="'settings.security.title' | translate" [subtitle]="'settings.security.subtitle' | translate" icon="shield">
          <form class="stack" [formGroup]="securityForm" (ngSubmit)="changePassword()" novalidate>
            <ui-alert kind="warning" [title]="'settings.security.revokeNote' | translate" />

            <ui-input
              formControlName="current"
              type="password"
              icon="shield"
              autocomplete="current-password"
              [disabled]="savingSecurity()"
              [label]="'settings.security.current' | translate"
              [required]="true"
            />
            <ui-input
              formControlName="next"
              type="password"
              icon="plus"
              autocomplete="new-password"
              [disabled]="savingSecurity()"
              [hint]="'settings.security.policy' | translate"
              [label]="'settings.security.next' | translate"
              [required]="true"
            />
            <ui-input
              formControlName="confirm"
              type="password"
              icon="plus"
              autocomplete="new-password"
              [disabled]="savingSecurity()"
              [errors]="confirmErrors()"
              [label]="'settings.security.confirm' | translate"
              [required]="true"
            />

            @if (securityError(); as key) {
              <ui-alert kind="danger" [title]="key | translate" />
            }

            <ui-button type="submit" icon="save" [loading]="savingSecurity()" [disabled]="savingSecurity()">
              {{ 'settings.security.submit' | translate }}
            </ui-button>
          </form>
        </ui-card>

        <ui-card [title]="'settings.session.title' | translate" [subtitle]="'settings.session.subtitle' | translate" icon="clock">
          @if (user(); as account) {
            <dl class="rows">
              <div class="row">
                <dt>{{ 'settings.session.email' | translate }}</dt>
                <dd class="wrap">{{ account.email }}</dd>
              </div>
              <div class="row">
                <dt>{{ 'settings.session.role' | translate }}</dt>
                <dd><ui-badge [label]="'settings.session.roles.' + account.role | translate" kind="info" /></dd>
              </div>
              <div class="row">
                <dt>{{ 'settings.session.linked' | translate }}</dt>
                <dd class="mono">{{ account.linkedId === null ? ('settings.session.noLinked' | translate) : account.linkedId }}</dd>
              </div>
              <div class="row">
                <dt>{{ 'settings.session.lastLogin' | translate }}</dt>
                <dd>{{ account.lastLoginAt === null ? ('common.notSet' | translate) : date(account.lastLoginAt) }}</dd>
              </div>
            </dl>
          } @else {
            <ui-skeleton [lines]="3" />
          }
          <footer uiCardFooter>
            <div class="actions">
              <ui-button variant="danger" icon="log-out" (click)="signOut()">
                {{ 'settings.session.signOut' | translate }}
              </ui-button>
            </div>
          </footer>
        </ui-card>

        @if (isAdmin) {
          <ui-card
            [title]="'settings.platform.title' | translate"
            [subtitle]="'settings.platform.subtitle' | translate"
            icon="activity"
          >
            <ng-template #actions>
              <ui-button variant="ghost" size="sm" icon="refresh" [loading]="statusLoading()" (click)="loadStatus()">
                {{ 'settings.platform.recheck' | translate }}
              </ui-button>
            </ng-template>

            @if (statusError(); as key) {
              <ui-error-state
                [title]="'settings.platform.statusFailed' | translate"
                [message]="key | translate"
                (retry)="loadStatus()"
              />
            } @else if (statusLoading()) {
              <div class="stack-sm">
                <ui-skeleton height="20px" width="55%" />
                <ui-skeleton height="20px" width="40%" />
                <ui-skeleton height="20px" width="45%" />
              </div>
            } @else {
              <div class="stack-sm">
                <dl class="rows">
                  @if (endpoint(); as info) {
                    <div class="row">
                      <dt>{{ 'settings.platform.endpoint' | translate }}</dt>
                      <dd>{{ info.name }} <span class="muted">{{ info.version }} · {{ info.environment }}</span></dd>
                    </div>
                    <div class="row">
                      <dt>{{ 'settings.platform.dataset' | translate }}</dt>
                      <dd class="mono wrap">{{ info.dataset }}</dd>
                    </div>
                  }
                  @if (healthPayload(); as probe) {
                    <div class="row">
                      <dt>{{ 'settings.platform.sparql' | translate }}</dt>
                      <dd class="badge-cell">
                        <ui-badge [label]="storeLabel()" [kind]="storeKind()" dot />
                        @if (probe.tripleStore.dataset) {
                          <span class="mono muted">{{ probe.tripleStore.dataset }}</span>
                        }
                      </dd>
                    </div>
                    <div class="row">
                      <dt>{{ 'settings.platform.nlp' | translate }}</dt>
                      <dd class="badge-cell">
                        <ui-badge [label]="nlpLabel()" [kind]="nlpKind()" dot />
                      </dd>
                    </div>
                    @if (probe.tripleStore.error) {
                      <p class="hint mono wrap">{{ probe.tripleStore.error }}</p>
                    }
                    @if (probe.nlp.error) {
                      <p class="hint mono wrap">{{ probe.nlp.error }}</p>
                    }
                  }
                </dl>
                <p class="hint">{{ 'settings.platform.storeHint' | translate }}</p>
              </div>
            }
          </ui-card>

          @if (statsError(); as key) {
            <ui-card [title]="'settings.platform.census' | translate" icon="database">
              <ui-error-state
                [title]="'settings.platform.statsFailed' | translate"
                [message]="key | translate"
                (retry)="loadStats()"
              />
            </ui-card>
          } @else {
            <div class="grid-kpi">
              <ui-stat-card
                icon="database"
                [loading]="statsLoading()"
                [value]="count(stats()?.triples ?? healthTripleCount())"
                [label]="'settings.platform.triples' | translate"
                [hint]="splitHint()"
              />
              <ui-stat-card
                icon="git-branch"
                [loading]="statsLoading()"
                [value]="count(stats()?.classes)"
                [label]="'settings.platform.classes' | translate"
              />
              <ui-stat-card
                icon="users"
                [loading]="statsLoading()"
                [value]="count(stats()?.namedIndividuals)"
                [label]="'settings.platform.individuals' | translate"
              />
              <ui-stat-card
                icon="waypoints"
                [loading]="statsLoading()"
                [value]="count(stats()?.objectProperties)"
                [label]="'settings.platform.objectProperties' | translate"
              />
              <ui-stat-card
                icon="braces"
                [loading]="statsLoading()"
                [value]="count(stats()?.datatypeProperties)"
                [label]="'settings.platform.datatypeProperties' | translate"
              />
              <ui-stat-card
                icon="tag"
                [loading]="statsLoading()"
                [value]="count(stats()?.annotationProperties)"
                [label]="'settings.platform.annotationProperties' | translate"
              />
            </div>

            @if (stats(); as census) {
              <ui-card [title]="'settings.platform.byEntity' | translate" [subtitle]="censusHint()" icon="list">
                <ng-template #actions>
                  <div class="actions">
                    <ui-button variant="outline" size="sm" icon="waypoints" (click)="openExplorer()">
                      {{ 'settings.platform.explorer' | translate }}
                    </ui-button>
                    <ui-button variant="outline" size="sm" icon="shield" (click)="openConsistency()">
                      {{ 'settings.platform.consistency' | translate }}
                    </ui-button>
                  </div>
                </ng-template>
                <dl class="rows">
                  @for (row of entityRows(); track row.key) {
                    <div class="row">
                      <dt>{{ 'settings.entity.' + row.key | translate }}</dt>
                      <dd>{{ count(row.value) }}</dd>
                    </div>
                  }
                </dl>
              </ui-card>
            }
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .rows {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .row {
        display: grid;
        grid-template-columns: minmax(120px, 40%) minmax(0, 1fr);
        gap: var(--sp-3);
        align-items: baseline;
      }
      dt {
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--text-muted);
      }
      dd {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text);
      }
      .badge-cell {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .hint {
        margin: 0;
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        font-size: var(--fs-xs);
        line-height: 1.6;
        color: var(--text-muted);
      }
      .muted {
        color: var(--text-subtle);
      }
      .mono {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
      }
      .wrap,
      .mono {
        overflow-wrap: anywhere;
      }
      @media (max-width: 560px) {
        .row {
          grid-template-columns: minmax(0, 1fr);
          gap: var(--sp-1);
        }
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private readonly accounts = inject(AccountService);
  private readonly auth = inject(AuthService);
  private readonly health = inject(HealthService);
  private readonly ontology = inject(OntologyService);
  private readonly lang = inject(LangService);
  private readonly theme = inject(ThemeService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isAdmin = this.auth.hasRole('ADMIN');
  readonly user = this.auth.user;

  readonly preferencesForm = inject(FormBuilder).group({
    theme: ['system'],
    lang: ['en'],
  });

  readonly securityForm = inject(FormBuilder).group({
    current: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(200)]],
    next: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(200), passwordPolicy]],
    confirm: ['', [Validators.required, matchesPassword]],
  });

  /** `ui-radio-group` resolves the labels itself, so raw keys are passed. */
  readonly themeOptions: SelectOption[] = [
    { value: 'light', label: 'common.themeLight' },
    { value: 'dark', label: 'common.themeDark' },
    { value: 'system', label: 'common.themeSystem' },
  ];

  readonly languageOptions: SelectOption[] = [
    { value: 'en', label: 'settings.appearance.english' },
    { value: 'fr', label: 'settings.appearance.french' },
  ];

  readonly savingSecurity = signal(false);
  readonly securityError = signal<string | null>(null);
  readonly confirmErrors = signal<string[] | null>(null);

  readonly endpoint = signal<EndpointInfo | null>(null);
  readonly healthPayload = signal<HealthPayload | null>(null);
  readonly statusLoading = signal(false);
  readonly statusError = signal<string | null>(null);

  readonly stats = signal<OntologyStats | null>(null);
  readonly statsLoading = signal(false);
  readonly statsError = signal<string | null>(null);

  readonly entityRows = computed<EntityCountRow[]>(() => {
    const census = this.stats();
    if (!census) return [];
    return Object.entries(census.individualsByEntity).map(([key, value]) => ({ key, value }));
  });

  readonly healthTripleCount = computed<number | null>(() => this.healthPayload()?.tripleStore.triples ?? null);

  ngOnInit(): void {
    this.preferencesForm.patchValue({ theme: this.theme.mode(), lang: this.lang.get() }, { emitEvent: false });

    this.preferencesForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      const mode = value['theme'];
      if (mode === 'system' || mode === 'light' || mode === 'dark') this.theme.setMode(mode);
      const next = value['lang'];
      if (next === 'en' || next === 'fr') this.lang.set(next);
    });

    merge(this.securityForm.controls.next.events, this.securityForm.controls.confirm.events)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshConfirmErrors());

    if (this.isAdmin) {
      this.loadStatus();
      this.loadStats();
    }
  }

  protected changePassword(): void {
    if (this.savingSecurity()) return;
    if (this.securityForm.invalid) {
      this.securityForm.markAllAsTouched();
      this.refreshConfirmErrors();
      return;
    }
    const raw = this.securityForm.getRawValue();
    this.savingSecurity.set(true);
    this.securityError.set(null);
    this.accounts.changePassword(raw['current'] ?? '', raw['next'] ?? '').subscribe({
      next: () => {
        this.savingSecurity.set(false);
        this.toasts.success(this.translate.instant('settings.security.changed'));
        // `POST /auth/change-password` revokes every session of the account
        // server-side, so the honest follow-up is a clean re-login.
        this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
      },
      error: (error: HttpErrorResponse) => {
        this.savingSecurity.set(false);
        this.securityError.set(error.status === 401 ? 'settings.security.wrongCurrent' : this.keyFor(error));
      },
    });
  }

  protected signOut(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }

  protected loadStatus(): void {
    this.statusLoading.set(true);
    this.statusError.set(null);
    let pending = 2;
    const settled = (): void => {
      pending -= 1;
      if (pending <= 0) this.statusLoading.set(false);
    };
    // the probe answers 503 with the report as its body: it is data, never a toast
    this.health.status().subscribe({
      next: (info) => {
        this.endpoint.set(info);
        settled();
      },
      error: (error: HttpErrorResponse) => {
        this.statusError.set(this.keyFor(error));
        settled();
      },
    });
    this.health.check().subscribe({
      next: (payload) => {
        this.healthPayload.set(payload);
        settled();
      },
      error: () => settled(),
    });
  }

  protected loadStats(): void {
    this.statsLoading.set(true);
    this.statsError.set(null);
    this.ontology.stats().subscribe({
      next: (census) => {
        this.statsLoading.set(false);
        this.stats.set(census);
      },
      error: (error: HttpErrorResponse) => {
        this.statsLoading.set(false);
        this.statsError.set(this.keyFor(error));
      },
    });
  }

  protected openExplorer(): void {
    void this.router.navigateByUrl('/tools/explorer');
  }

  protected openConsistency(): void {
    void this.router.navigateByUrl('/admin/consistency');
  }

  protected date(value: string | null): string {
    return formatDateTime(value, this.lang.get());
  }

  protected count(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat(this.lang.get() === 'fr' ? 'fr-FR' : 'en-GB').format(value);
  }

  protected storeOk(): boolean | null {
    const probe = this.healthPayload();
    if (probe) return probe.tripleStore.ok;
    const info = this.endpoint();
    return info === null ? null : info.sparql.ok;
  }

  protected storeKind(): BadgeKind {
    const ok = this.storeOk();
    if (ok === null) return 'neutral';
    return ok ? 'success' : 'danger';
  }

  protected storeLabel(): string {
    const ok = this.storeOk();
    if (ok === null) return this.translate.instant('common.loading');
    return this.translate.instant(ok ? 'settings.platform.reachable' : 'settings.platform.unreachable');
  }

  protected nlpKind(): BadgeKind {
    const probe = this.healthPayload();
    if (!probe) return 'neutral';
    return probe.nlp.ok ? 'success' : 'warning';
  }

  protected nlpLabel(): string {
    const probe = this.healthPayload();
    if (!probe) return this.translate.instant('common.loading');
    return this.translate.instant(probe.nlp.ok ? 'settings.platform.reachable' : 'settings.platform.unreachable');
  }

  protected splitHint(): string {
    const census = this.stats();
    if (!census) return '';
    return `${this.translate.instant('settings.platform.tbox')}: ${this.count(census.tboxTriples)} · ${this.translate.instant(
      'settings.platform.abox',
    )}: ${this.count(census.aboxTriples)}`;
  }

  protected censusHint(): string {
    const census = this.stats();
    if (!census) return '';
    return `${this.translate.instant('settings.platform.objectProperties')}: ${this.count(census.objectProperties)} · ${this.translate.instant(
      'settings.platform.datatypeProperties',
    )}: ${this.count(census.datatypeProperties)} · ${this.translate.instant(
      'settings.platform.annotationProperties',
    )}: ${this.count(census.annotationProperties)}`;
  }

  private refreshConfirmErrors(): void {
    const control = this.securityForm.controls.confirm;
    const show = (control.touched || control.dirty) && control.hasError('passwordMismatch');
    this.confirmErrors.set(show ? ['settings.security.mismatch'] : null);
  }

  private keyFor(error: HttpErrorResponse): string {
    if (error.status === 0) return 'errors.OFFLINE';
    if (error.status === 401) return 'errors.UNAUTHORIZED';
    if (error.status === 403) return 'errors.FORBIDDEN';
    if (error.status === 404) return 'errors.NOT_FOUND';
    if (error.status === 409) return 'errors.CONFLICT';
    if (error.status === 429) return 'errors.RATE_LIMITED';
    return 'errors.generic';
  }
}
