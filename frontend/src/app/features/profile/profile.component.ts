import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors, type ValidatorFn } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { merge } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiAvatarComponent } from '../../shared/ui/avatar/ui-avatar.component';
import { UiBadgeComponent, type BadgeKind } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiCardFooterDirective } from '../../shared/ui/card/ui-card-footer.directive';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { UiInputComponent } from '../../shared/ui/input/ui-input.component';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiPageMetaDirective } from '../../shared/ui/page-header/ui-page-meta.directive';
import { UiRadioGroupComponent } from '../../shared/ui/radio/ui-radio-group.component';
import type { SelectOption } from '../../shared/ui/select/ui-select.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiStatCardComponent } from '../../shared/ui/stat-card/ui-stat-card.component';
import { AccountService } from '../../core/api/account.service';
import { HealthService, type HealthPayload } from '../../core/api/insight.service';
import { OntologyService } from '../../core/api/ontology.service';
import type { Individual, OntologyStats, PublicUser } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { LangService } from '../../core/i18n/i18n';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/toast/toast.service';
import { formatDateTime, relativeTime } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';

interface ProfileTab {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
}

interface SessionRowView {
  readonly id: string;
  readonly created: string;
  readonly createdAgo: string;
  readonly expires: string;
  readonly expiresBy: string;
}

/** Same policy the REST `change-password` endpoint enforces. */
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

/** The unknown `profile` of `/auth/me` is the clinical individual, when linked. */
const asIndividual = (value: unknown): Individual | null => {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<Individual>;
  if (typeof candidate.id !== 'string') return null;
  return {
    id: candidate.id,
    iri: candidate.iri ?? '',
    label: candidate.label ?? candidate.id,
    types: candidate.types ?? [],
    fields: candidate.fields ?? {},
    relations: candidate.relations ?? {},
  };
};

/**
 * Profile and settings, one screen for every role. ADMIN gets a fifth tab with
 * the platform state, because only that role may read the health probe.
 */
@Component({
  selector: 'page-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslateModule,
    UiAlertComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiCardFooterDirective,
    UiIconComponent,
    UiInputComponent,
    UiPageHeaderComponent,
    UiPageMetaDirective,
    UiRadioGroupComponent,
    UiSkeletonComponent,
    UiStatCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <ui-page-header
        [title]="'profile.title' | translate"
        [subtitle]="'profile.subtitle' | translate"
        icon="user"
        [back]="false"
      >
        @if (user(); as account) {
          <div uiPageMeta class="meta">
            <ui-avatar [name]="account.fullName" [role]="account.role" size="sm" />
            <ui-badge [label]="roleLabel(account)" kind="info" />
          </div>
        }
      </ui-page-header>

      @if (loadError(); as key) {
        <ui-alert kind="danger" [title]="key | translate">
          <div class="actions">
            <ui-button variant="outline" size="sm" icon="refresh" (click)="loadAccount()">
              {{ 'common.retry' | translate }}
            </ui-button>
          </div>
        </ui-alert>
      }

      @if (!user() && !loadError()) {
        <div class="stack">
          <ui-skeleton height="20px" width="40%" />
          <ui-skeleton [lines]="4" />
        </div>
      }

      @if (user(); as account) {
        <div class="stack">
            <ui-card [title]="'profile.account.title' | translate" [subtitle]="'profile.account.subtitle' | translate" icon="user">
              @if (isAdmin) {
                <form class="stack" [formGroup]="accountForm" (ngSubmit)="saveAccount()" novalidate>
                  <div class="form-grid">
                    <ui-input
                      formControlName="fullName"
                      icon="user"
                      [disabled]="savingAccount()"
                      [label]="'profile.field.fullName' | translate"
                      [required]="true"
                    />
                    <ui-input
                      formControlName="email"
                      type="email"
                      icon="mail"
                      autocomplete="email"
                      [disabled]="savingAccount()"
                      [hint]="'profile.account.emailHint' | translate"
                      [label]="'profile.field.email' | translate"
                      [required]="true"
                    />
                  </div>
                  @if (accountError(); as key) {
                    <ui-alert kind="danger" [title]="key | translate" />
                  }
                  <p class="hint">{{ 'profile.account.adminNote' | translate }}</p>
                  <div class="actions">
                    <ui-button type="submit" icon="save" [loading]="savingAccount()" [disabled]="savingAccount()">
                      {{ 'profile.account.save' | translate }}
                    </ui-button>
                    <ui-button variant="outline" icon="users" (click)="openUsers()">
                      {{ 'profile.account.openUsers' | translate }}
                    </ui-button>
                  </div>
                </form>
              } @else {
                <dl class="rows">
                  <div class="row">
                    <dt>{{ 'profile.field.fullName' | translate }}</dt>
                    <dd>{{ account.fullName }}</dd>
                  </div>
                  <div class="row">
                    <dt>{{ 'profile.field.email' | translate }}</dt>
                    <dd class="wrap">{{ account.email }}</dd>
                  </div>
                </dl>
              }

              <dl class="rows">
                <div class="row">
                  <dt>{{ 'profile.field.role' | translate }}</dt>
                  <dd>{{ roleLabel(account) }}</dd>
                </div>
                <div class="row">
                  <dt>{{ 'profile.field.created' | translate }}</dt>
                  <dd>{{ date(account.createdAt) }}</dd>
                </div>
                <div class="row">
                  <dt>{{ 'profile.field.lastLogin' | translate }}</dt>
                  <dd>{{ account.lastLoginAt === null ? ('common.notSet' | translate) : date(account.lastLoginAt) }}</dd>
                </div>
              </dl>
            </ui-card>

            @if (hasClinicalProfile()) {
              <ui-card
                [title]="'profile.account.clinicalTitle' | translate"
                [subtitle]="'profile.account.clinicalSubtitle' | translate"
                icon="heart"
              >
                @if (clinical(); as record) {
                  <p class="clinical">
                    <span class="clinical__label">{{ record.label }}</span>
                    <code class="mono">{{ record.id }}</code>
                  </p>
                  @if (clinicalRows().length > 0) {
                    <table class="table">
                      <caption class="visually-hidden">{{ 'profile.account.clinicalTitle' | translate }}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{{ 'profile.account.predicate' | translate }}</th>
                          <th scope="col">{{ 'profile.field.value' | translate }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of clinicalRows(); track row.predicate) {
                          <tr>
                            <td class="mono">{{ row.predicate }}</td>
                            <td>{{ row.value }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  }
                }
              </ui-card>
            } @else if (hasClinicalRole()) {
              <ui-card [title]="'profile.account.clinicalTitle' | translate" icon="heart">
                <p class="hint">{{ 'profile.account.noClinical' | translate }}</p>
              </ui-card>
            }
        </div>

        @if (activeTab() === 'security') {
          <ui-card [title]="'profile.security.title' | translate" [subtitle]="'profile.security.subtitle' | translate" icon="shield">
            <form class="stack" [formGroup]="securityForm" (ngSubmit)="changePassword()" novalidate>
              <ui-alert kind="warning" [title]="'profile.security.revokeNote' | translate" />

              <ui-input
                formControlName="current"
                type="password"
                icon="shield"
                autocomplete="current-password"
                [disabled]="savingSecurity()"
                [label]="'profile.security.current' | translate"
                [required]="true"
              />
              <ui-input
                formControlName="next"
                type="password"
                icon="plus"
                autocomplete="new-password"
                [disabled]="savingSecurity()"
                [hint]="'profile.security.policy' | translate"
                [label]="'profile.security.next' | translate"
                [required]="true"
              />
              <ui-input
                formControlName="confirm"
                type="password"
                icon="plus"
                autocomplete="new-password"
                [disabled]="savingSecurity()"
                [errors]="confirmErrors()"
                [label]="'profile.security.confirm' | translate"
                [required]="true"
              />

              @if (securityError(); as key) {
                <ui-alert kind="danger" [title]="key | translate" />
              }

              <ui-button type="submit" icon="save" [loading]="savingSecurity()" [disabled]="savingSecurity()">
                {{ 'profile.security.submit' | translate }}
              </ui-button>
            </form>
          </ui-card>
        }

        @if (activeTab() === 'preferences') {
          <ui-card
            [title]="'profile.preferences.title' | translate"
            [subtitle]="'profile.preferences.subtitle' | translate"
            icon="sliders"
          >
            <form class="stack" [formGroup]="preferencesForm" novalidate>
              <ui-radio-group
                formControlName="theme"
                name="profile-theme-mode"
                layout="row"
                [options]="themeOptions()"
                [label]="'profile.preferences.theme' | translate"
                [hint]="'profile.preferences.themeHint' | translate"
              />
              <ui-radio-group
                formControlName="lang"
                name="profile-language"
                layout="row"
                [options]="languageOptions()"
                [label]="'profile.preferences.language' | translate"
                [hint]="'profile.preferences.languageHint' | translate"
              />
              <p class="hint">
                <ui-icon name="check" size="14" />
                <span>{{ 'profile.preferences.saved' | translate }}</span>
              </p>
            </form>
          </ui-card>
        }

        @if (activeTab() === 'sessions') {
          <ui-card [title]="'profile.sessions.title' | translate" [subtitle]="'profile.sessions.subtitle' | translate" icon="clock">
            <ng-template #actions>
              <ui-button variant="ghost" size="sm" icon="refresh" [loading]="sessionsLoading()" (click)="loadSessions()">
                {{ 'profile.sessions.refresh' | translate }}
              </ui-button>
            </ng-template>

            @if (sessionsLoading()) {
              <ui-skeleton [lines]="3" />
            } @else if (sessions().length === 0) {
              <p class="hint">{{ 'profile.sessions.empty' | translate }}</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <caption class="visually-hidden">{{ 'profile.sessions.title' | translate }}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ 'profile.sessions.id' | translate }}</th>
                      <th scope="col">{{ 'profile.sessions.created' | translate }}</th>
                      <th scope="col">{{ 'profile.sessions.expires' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of sessions(); track row.id) {
                      <tr>
                        <td class="mono">{{ row.id }}</td>
                        <td>
                          <span class="block">{{ row.created }}</span>
                          <span class="block muted">{{ row.createdAgo }}</span>
                        </td>
                        <td>
                          <span class="block">{{ row.expires }}</span>
                          <span class="block muted">{{ row.expiresBy }}</span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            <footer uiCardFooter>
              <span>{{ 'profile.sessions.hint' | translate }}</span>
            </footer>
          </ui-card>
        }

        @if (isAdmin && activeTab() === 'platform') {
          <div class="stack">
            <ui-card [title]="'profile.platform.title' | translate" [subtitle]="'profile.platform.subtitle' | translate" icon="activity">
              <ng-template #actions>
                <ui-button variant="ghost" size="sm" icon="refresh" [loading]="platformLoading()" (click)="loadPlatform()">
                  {{ 'profile.platform.refresh' | translate }}
                </ui-button>
              </ng-template>

              <div class="stack-sm">
                @if (healthPayload(); as probe) {
                  <div class="status">
                    <span class="status__name">{{ 'profile.platform.store' | translate }}</span>
                    <ui-badge [label]="storeLabel()" [kind]="storeKind()" dot />
                    @if (probe.tripleStore.dataset) {
                      <span class="mono muted">{{ probe.tripleStore.dataset }}</span>
                    }
                  </div>
                  <div class="status">
                    <span class="status__name">{{ 'profile.platform.nlp' | translate }}</span>
                    <ui-badge [label]="nlpLabel()" [kind]="nlpKind()" dot />
                  </div>
                  @if (storeError(); as message) {
                    <p class="hint mono">{{ message }}</p>
                  }
                } @else {
                  <ui-skeleton height="18px" width="60%" />
                }
                <p class="hint">{{ 'profile.platform.storeHint' | translate }}</p>
              </div>
            </ui-card>

            <div class="grid-kpi">
              <ui-stat-card
                icon="database"
                [loading]="platformLoading()"
                [value]="count(stats()?.triples ?? healthTripleCount())"
                [label]="'profile.platform.triples' | translate"
                [hint]="datasetLabel()"
              />
              <ui-stat-card
                icon="git-branch"
                [loading]="platformLoading()"
                [value]="count(stats()?.classes)"
                [label]="'profile.platform.classes' | translate"
                [hint]="splitLabel()"
              />
              <ui-stat-card
                icon="users"
                [loading]="platformLoading()"
                [value]="count(stats()?.namedIndividuals)"
                [label]="'profile.platform.individuals' | translate"
              />
              <ui-stat-card
                icon="braces"
                [loading]="platformLoading()"
                [value]="count(axiomCount())"
                [label]="'profile.platform.axioms' | translate"
                [hint]="propertiesLabel()"
              />
            </div>
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
      .meta {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
      }
      .rows {
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
        gap: var(--sp-2);
      }
      .rows + .rows {
        margin-top: var(--sp-4);
        padding-top: var(--sp-4);
        border-top: 1px solid var(--border);
      }
      .row {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--sp-1);
        min-width: 0;
        padding: var(--sp-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        background: var(--bg-hover);
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
        overflow-wrap: anywhere;
      }
      .form-grid {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: minmax(0, 1fr);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .hint {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        margin: 0;
        font-size: var(--fs-xs);
        line-height: 1.6;
        color: var(--text-muted);
      }
      .muted,
      .block.muted {
        color: var(--text-subtle);
      }
      .mono {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        overflow-wrap: anywhere;
      }
      .wrap {
        overflow-wrap: anywhere;
      }
      .block {
        display: block;
        font-size: var(--fs-xs);
      }
      .clinical {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
        margin: 0 0 var(--sp-3);
      }
      .clinical__label {
        font-size: var(--fs-md);
        font-weight: 600;
      }
      .table-wrap {
        overflow-x: auto;
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-sm);
      }
      .table th,
      .table td {
        text-align: start;
        padding: var(--sp-2);
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }
      .table th {
        color: var(--text-muted);
        font-weight: 600;
        white-space: nowrap;
      }
      .table tbody tr:last-child td {
        border-bottom: 0;
      }
      .status {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
      }
      .status__name {
        flex: 1 1 auto;
        font-size: var(--fs-sm);
        font-weight: 600;
      }
      @media (min-width: 561px) {
        .form-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `,
  ],
})
export class ProfileComponent implements OnInit {
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

  readonly accountForm = inject(FormBuilder).group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(160)]],
  });

  readonly securityForm = inject(FormBuilder).group({
    current: ['', [Validators.required]],
    next: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(200), passwordPolicy]],
    confirm: ['', [Validators.required, matchesPassword]],
  });

  readonly preferencesForm = inject(FormBuilder).group({
    theme: ['system'],
    lang: ['en'],
  });

  readonly activeTab = signal<string>('account');
  readonly user = signal<PublicUser | null>(null);
  readonly clinical = signal<Individual | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly accountError = signal<string | null>(null);
  readonly securityError = signal<string | null>(null);
  readonly confirmErrors = signal<string[] | null>(null);
  readonly savingAccount = signal(false);
  readonly savingSecurity = signal(false);

  readonly sessions = signal<SessionRowView[]>([]);
  readonly sessionsLoading = signal(false);
  private sessionsLoaded = false;
  private pendingProbes = 0;

  readonly healthPayload = signal<HealthPayload | null>(null);
  readonly stats = signal<OntologyStats | null>(null);
  readonly platformLoading = signal(false);
  private platformLoaded = false;

  /** Bumping this recomputes every label that was resolved with `instant`. */
  private readonly langTick = signal(0);

  readonly tabs = computed<ProfileTab[]>(() => {
    this.langTick();
    const list: ProfileTab[] = [
      { id: 'account', label: this.translate.instant('profile.tabs.account'), icon: 'user' },
      { id: 'security', label: this.translate.instant('profile.tabs.security'), icon: 'shield' },
      { id: 'preferences', label: this.translate.instant('profile.tabs.preferences'), icon: 'sliders' },
      { id: 'sessions', label: this.translate.instant('profile.tabs.sessions'), icon: 'clock' },
    ];
    if (this.isAdmin) {
      list.push({ id: 'platform', label: this.translate.instant('profile.tabs.platform'), icon: 'activity' });
    }
    return list;
  });

  readonly themeOptions = computed<SelectOption[]>(() => {
    this.langTick();
    return [
      { value: 'system', label: this.translate.instant('common.themeSystem') },
      { value: 'light', label: this.translate.instant('common.themeLight') },
      { value: 'dark', label: this.translate.instant('common.themeDark') },
    ];
  });

  readonly languageOptions = computed<SelectOption[]>(() => {
    this.langTick();
    return [
      { value: 'en', label: this.translate.instant('profile.preferences.english') },
      { value: 'fr', label: this.translate.instant('profile.preferences.french') },
    ];
  });

  readonly clinicalRows = computed<{ predicate: string; value: string }[]>(() => {
    const individual = this.clinical();
    if (individual === null) return [];
    return Object.entries(individual.fields)
      .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
      .map(([predicate, value]) => ({ predicate, value: String(value) }));
  });

  readonly hasClinicalRole = computed(() => this.auth.hasRole('PATIENT', 'DOCTOR'));
  readonly hasClinicalProfile = computed(() => this.hasClinicalRole() && this.clinical() !== null);

  ngOnInit(): void {
    this.preferencesForm.patchValue({ theme: this.theme.mode(), lang: this.lang.get() }, { emitEvent: false });
    this.accountForm.patchValue(this.prefill(), { emitEvent: false });

    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.langTick.update((tick) => tick + 1));

    merge(this.securityForm.controls.next.events, this.securityForm.controls.confirm.events)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshConfirmErrors());

    this.preferencesForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      const mode = value['theme'];
      if (mode === 'system' || mode === 'light' || mode === 'dark') this.theme.setMode(mode);
      const next = value['lang'];
      if (next === 'en' || next === 'fr') this.lang.set(next);
    });

    this.loadAccount();
  }

  protected loadAccount(): void {
    this.loadError.set(null);
    this.accounts.me().subscribe({
      next: (response) => {
        this.user.set(response.user);
        this.clinical.set(asIndividual(response.profile));
        this.accountForm.patchValue(this.prefill(), { emitEvent: false });
      },
      error: (error: HttpErrorResponse) => this.loadError.set(this.keyFor(error)),
    });
  }

  protected setActive(id: string): void {
    this.activeTab.set(id);
    if (id === 'sessions' && !this.sessionsLoaded) this.loadSessions();
    if (id === 'platform' && this.isAdmin && !this.platformLoaded) this.loadPlatform();
  }

  /** `PUT /users/:id` is the admin surface; it is also what an ADMIN uses on itself. */
  protected saveAccount(): void {
    const account = this.user();
    if (account === null || this.savingAccount()) return;
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }
    const raw = this.accountForm.getRawValue();
    this.savingAccount.set(true);
    this.accountError.set(null);
    this.accounts
      .update(account.id, {
        fullName: (raw['fullName'] ?? '').trim(),
        email: (raw['email'] ?? '').trim(),
      })
      .subscribe({
        next: () => {
          this.savingAccount.set(false);
          this.toasts.success(this.translate.instant('profile.account.saved'));
          // AuthService keeps the session copy of the account in sync for the shell
          this.auth.me().subscribe({
            next: (user) => this.user.set(user),
            error: () => this.loadAccount(),
          });
        },
        error: (error: HttpErrorResponse) => {
          this.savingAccount.set(false);
          this.accountError.set(this.keyFor(error));
        },
      });
  }

  protected openUsers(): void {
    void this.router.navigateByUrl('/admin/users');
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
        this.toasts.success(this.translate.instant('profile.security.changed'));
        // every session is revoked server-side: force a clean re-login
        this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
      },
      error: (error: HttpErrorResponse) => {
        this.savingSecurity.set(false);
        this.securityError.set(error.status === 401 ? 'profile.security.wrongCurrent' : this.keyFor(error));
      },
    });
  }

  protected loadSessions(): void {
    this.sessionsLoading.set(true);
    this.accounts.sessions().subscribe({
      next: (response) => {
        this.sessionsLoading.set(false);
        this.sessionsLoaded = true;
        this.sessions.set(
          response.sessions.map((row) => ({
            id: row.id,
            created: this.date(row.createdAt),
            createdAgo: this.ago(row.createdAt),
            expires: this.date(row.expiresAt),
            expiresBy: this.ago(row.expiresAt),
          })),
        );
      },
      error: (error: HttpErrorResponse) => {
        this.sessionsLoading.set(false);
        this.toasts.error(this.translate.instant('common.operationFailed'), this.translate.instant(this.keyFor(error)));
      },
    });
  }

  protected loadPlatform(): void {
    this.platformLoading.set(true);
    this.platformLoaded = true;
    this.pendingProbes = 2;
    const settled = (): void => {
      this.pendingProbes -= 1;
      if (this.pendingProbes <= 0) this.platformLoading.set(false);
    };
    // the probe answers 503 with the report as its body: it is data, never a toast
    this.health.check().subscribe({
      next: (payload) => {
        this.healthPayload.set(payload);
        settled();
      },
      error: () => settled(),
    });
    this.ontology.stats().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        settled();
      },
      error: () => settled(),
    });
  }

  protected roleLabel(account: PublicUser): string {
    this.langTick();
    return labelOf(this.translate, `profile.roles.${account.role}`, account.role);
  }

  protected date(value: string | null): string {
    return formatDateTime(value, this.lang.get());
  }

  protected ago(value: string | null): string {
    return relativeTime(value, this.lang.get());
  }

  protected count(value: number | null | undefined): string {
    if (value === null || value === undefined) return this.translate.instant('profile.platform.unavailable');
    return new Intl.NumberFormat(this.lang.get() === 'fr' ? 'fr-FR' : 'en-GB').format(value);
  }

  protected readonly storeKind = computed<BadgeKind>(() => (this.healthPayload()?.tripleStore.ok ? 'success' : 'danger'));
  protected readonly nlpKind = computed<BadgeKind>(() => (this.healthPayload()?.nlp.ok ? 'success' : 'warning'));
  protected readonly storeLabel = computed<string>(() => {
    this.langTick();
    return this.translate.instant(this.healthPayload()?.tripleStore.ok ? 'profile.platform.reachable' : 'profile.platform.unreachable');
  });
  protected readonly nlpLabel = computed<string>(() => {
    this.langTick();
    return this.translate.instant(this.healthPayload()?.nlp.ok ? 'profile.platform.reachable' : 'profile.platform.unreachable');
  });
  protected readonly datasetLabel = computed<string>(() => this.healthPayload()?.tripleStore.dataset ?? '');
  protected readonly storeError = computed<string | null>(() => this.healthPayload()?.tripleStore.error ?? null);
  protected readonly healthTripleCount = computed<number | null>(() => this.healthPayload()?.tripleStore.triples ?? null);
  protected readonly axiomCount = computed<number | null>(() => {
    const axioms = this.stats()?.axioms;
    if (!axioms) return null;
    return Object.values(axioms).reduce((total, value) => total + value, 0);
  });

  protected splitLabel(): string {
    this.langTick();
    const stats = this.stats();
    if (!stats) return '';
    return `${this.translate.instant('profile.platform.tbox')}: ${this.count(stats.tboxTriples)} · ${this.translate.instant(
      'profile.platform.abox',
    )}: ${this.count(stats.aboxTriples)}`;
  }

  protected propertiesLabel(): string {
    this.langTick();
    const stats = this.stats();
    if (!stats) return '';
    return `${this.translate.instant('profile.platform.objectProperties')}: ${this.count(stats.objectProperties)} · ${this.translate.instant(
      'profile.platform.datatypeProperties',
    )}: ${this.count(stats.datatypeProperties)}`;
  }

  private prefill(): { fullName: string; email: string } {
    const account = this.user();
    return { fullName: account?.fullName ?? '', email: account?.email ?? '' };
  }

  private refreshConfirmErrors(): void {
    const control = this.securityForm.controls.confirm;
    const show = (control.touched || control.dirty) && control.hasError('passwordMismatch');
    this.confirmErrors.set(show ? ['profile.security.mismatch'] : null);
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
