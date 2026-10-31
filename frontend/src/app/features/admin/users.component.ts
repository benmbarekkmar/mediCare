import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { AccountService } from '../../core/api/account.service';
import { EntitiesService } from '../../core/api/entity.service';
import type { ApiProblem, EntityKey, PermissionMatrix, PublicUser, Ref, Role } from '../../core/api/models';
import { ENTITY_KEYS } from '../../core/api/models';
import { ToastService } from '../../core/toast/toast.service';
import { formatDateTime } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiComboboxComponent } from '../../shared/ui/combobox/ui-combobox.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiInputComponent } from '../../shared/ui/input/ui-input.component';
import { UiModalComponent } from '../../shared/ui/modal/ui-modal.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiSearchBoxComponent } from '../../shared/ui/search-box/ui-search-box.component';
import { UiSelectComponent } from '../../shared/ui/select/ui-select.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiSwitchComponent } from '../../shared/ui/switch/ui-switch.component';
import { UiTabsComponent } from '../../shared/ui/tabs/ui-tabs.component';
import {
  type TableColumn,
  UiCellDirective,
  UiIconButtonComponent,
  UiTableComponent,
} from '../../shared/ui/table/ui-table.component';
import type { BadgeKind } from '../../shared/ui/badge/ui-badge.component';

const ROLES: Role[] = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'];
const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

/** ADMIN account management: the user table, the account modal and the permission matrix. */
@Component({
  selector: 'admin-users',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    ReactiveFormsModule,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiCellDirective,
    UiComboboxComponent,
    UiConfirmDialogComponent,
    UiErrorStateComponent,
    UiIconButtonComponent,
    UiInputComponent,
    UiModalComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
    UiSearchBoxComponent,
    UiSelectComponent,
    UiSkeletonComponent,
    UiSwitchComponent,
    UiTabsComponent,
    UiTableComponent,
  ],
  template: `
    <div class="page users">
      <ui-page-header [title]="'admin.users.title' | translate" [subtitle]="subtitle()" icon="users">
        <ng-template uiPageActions>
          <ui-button icon="plus" (click)="openCreate()">{{ 'admin.users.create' | translate }}</ui-button>
        </ng-template>
      </ui-page-header>

      <ui-tabs [tabs]="tabs()" [active]="activeTab()" (activeChange)="activeTab.set($event)">
        @if (activeTab() === 'accounts') {
          @if (loadError()) {
            <ui-error-state
              [title]="'ui.error.title' | translate"
              [message]="'common.operationFailed' | translate"
              (retry)="load()"
            />
          } @else {
            <div class="toolbar">
              <ui-search-box
                [placeholder]="'admin.users.searchPlaceholder' | translate"
                [value]="term()"
                (valueChange)="term.set($event)"
                [loading]="loading()"
              />
            </div>

            @if (loading()) {
              <div class="table-skeleton" aria-busy="true" [attr.aria-label]="'common.loading' | translate">
                @for (row of skeletonRows; track row) {
                  <ui-skeleton height="48px"></ui-skeleton>
                }
              </div>
            } @else {
              <ui-table
                [columns]="columns()"
                [rows]="paged()"
                [total]="filtered().length"
                [sort]="sortSig()"
                [page]="page()"
                [pageSize]="pageSize()"
                [trackId]="'id'"
                exportName="users"
                [emptyTitle]="'admin.users.empty.title' | translate"
                [emptyHint]="'admin.users.empty.hint' | translate"
                [actionsLabel]="'common.actions' | translate"
                (sortChange)="onSort($event)"
                (pageChange)="onPage($event)"
              >
                <ng-template uiCell="fullName" let-row="row">
                  <span class="weight-600">{{ row.fullName }}</span>
                </ng-template>
                <ng-template uiCell="role" let-row="row">
                  <ui-badge [kind]="roleKind(row.role)" [label]="roleLabel(row.role)"></ui-badge>
                </ng-template>
                <ng-template uiCell="linkedId" let-row="row">
                  @if (row.linkedId) {
                    <span class="font-mono linked">{{ row.linkedId }}</span>
                  } @else {
                    <span class="text-muted">{{ 'common.notSet' | translate }}</span>
                  }
                </ng-template>
                <ng-template uiCell="active" let-row="row">
                  <ui-badge
                    [kind]="row.active ? 'success' : 'neutral'"
                    [dot]="true"
                    [label]="row.active ? ('admin.users.row.enabled' | translate) : ('admin.users.row.disabled' | translate)"
                  ></ui-badge>
                </ng-template>
                <ng-template uiCell="lastLoginAt" let-row="row">
                  <span class="nowrap">{{ absolute(row.lastLoginAt) }}</span>
                </ng-template>
                <ng-template uiCell="createdAt" let-row="row">
                  <span class="nowrap">{{ absolute(row.createdAt) }}</span>
                </ng-template>
                <ng-template uiRowActions let-row="row">
                  <ui-icon-button
                    icon="pencil"
                    [label]="aria('admin.users.row.edit', row.fullName)"
                    (click)="openEdit(row)"
                  ></ui-icon-button>
                  <ui-icon-button
                    [icon]="row.active ? 'circle-x' : 'circle-check'"
                    [label]="aria(row.active ? 'admin.users.row.deactivate' : 'admin.users.row.activate', row.fullName)"
                    (click)="toggleActive(row)"
                  ></ui-icon-button>
                  <ui-icon-button
                    icon="trash"
                    danger
                    [label]="aria('admin.users.row.remove', row.fullName)"
                    (click)="askDelete(row)"
                  ></ui-icon-button>
                </ng-template>
              </ui-table>
            }
          }
        } @else {
          <ui-card [title]="'admin.users.tabs.matrix' | translate" icon="shield">
            @if (matrix()) {
              <div class="matrix-wrap">
                <table class="matrix">
                  <caption class="visually-hidden">
                    {{ 'admin.users.matrix.caption' | translate }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ 'admin.users.matrix.entity' | translate }}</th>
                      @for (role of roleList(); track role) {
                        <th scope="col">{{ roleLabel(role) }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (entity of entityList(); track entity) {
                      <tr>
                        <th scope="row">{{ entityLabel(entity) }}</th>
                        @for (role of roleList(); track role) {
                          <td [attr.aria-label]="matrixCell(role, entity)">
                            @for (action of actionList; track action) {
                              @if (allowed(role, entity, action)) {
                                <span class="mark mark-on" aria-hidden="true">{{ actionLetter(action) }}</span>
                              } @else {
                                <span class="mark mark-off" aria-hidden="true">·</span>
                              }
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else if (!matrixLoading()) {
              <p class="text-muted text-sm">{{ 'common.operationFailed' | translate }}</p>
            } @else {
              <ui-skeleton height="240px"></ui-skeleton>
            }
          </ui-card>
        }
      </ui-tabs>

      <ui-modal
        [open]="dialogOpen()"
        (openChange)="dialogOpen.set($event)"
        [title]="editing() ? ('admin.users.edit' | translate) : ('admin.users.create' | translate)"
        size="md"
        [busy]="saving()"
      >
        <form [formGroup]="form" class="form stack" (ngSubmit)="save()">
          <ui-input
            label="{{ 'admin.users.form.email' | translate }}"
            formControlName="email"
            type="email"
            autocomplete="email"
            [required]="true"
          />
          <ui-input
            label="{{ 'admin.users.form.fullName' | translate }}"
            formControlName="fullName"
            autocomplete="name"
            [required]="true"
          />
          <ui-select
            [label]="'admin.users.form.role' | translate"
            formControlName="role"
            [options]="roleOptions()"
            [required]="true"
          />
          @if (linkedEntity(); as entity) {
            <ui-combobox
              [label]="'admin.users.form.linked' | translate"
              [hint]="entity === 'patients' ? ('admin.users.form.linkedPatient' | translate) : ('admin.users.form.linkedDoctor' | translate)"
              [search]="linkedSearch"
              [initial]="linkedInitial()"
              [required]="true"
              formControlName="linkedId"
              [placeholder]="'admin.users.form.linkedPlaceholder' | translate"
            />
          }
          @if (!editing()) {
            <ui-input
              label="{{ 'admin.users.form.password' | translate }}"
              formControlName="password"
              type="password"
              autocomplete="new-password"
              hint="{{ 'admin.users.form.passwordHint' | translate }}"
              [required]="true"
            />
          }
          <ui-select
            [label]="'admin.users.form.locale' | translate"
            formControlName="locale"
            [options]="localeOptions()"
          />
          <ui-switch
            [label]="'admin.users.form.active' | translate"
            [hint]="'admin.users.form.activeHint' | translate"
            formControlName="active"
          />
        </form>
        <ng-template #footer>
          <div class="row">
            <ui-button variant="ghost" (click)="closeModal()">{{ 'common.cancel' | translate }}</ui-button>
            <ui-button (click)="save()" [loading]="saving()">
              {{ (editing() ? 'common.updated' : 'common.create') | translate }}
            </ui-button>
          </div>
        </ng-template>
      </ui-modal>

      <ui-confirm-dialog
        [open]="deleteOpen()"
        (openChange)="deleteOpen.set($event)"
        [title]="'admin.users.deleteTitle' | translate"
        [message]="deleteMessage()"
        [confirmLabel]="'common.delete' | translate"
        [danger]="true"
        [busy]="deleting()"
        (confirmed)="confirmDelete()"
      />
    </div>
  `,
  styles: [
    `
      .users {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .toolbar {
        display: flex;
        max-width: 480px;
      }
      .table-skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .linked {
        font-size: var(--fs-xs);
        word-break: break-all;
      }
      .form {
        margin: 0;
      }
      .matrix-wrap {
        overflow-x: auto;
      }
      .matrix {
        border-collapse: collapse;
        width: 100%;
        font-size: var(--fs-sm);
      }
      .matrix th,
      .matrix td {
        padding: var(--sp-2) var(--sp-3);
        border-bottom: 1px solid var(--border);
        text-align: start;
      }
      .matrix thead th {
        color: var(--text-muted);
        font-weight: 600;
      }
      .mark {
        display: inline-block;
        min-width: 1.4em;
        text-align: center;
        border-radius: var(--radius-pill);
        transition: background var(--duration) var(--ease), color var(--duration) var(--ease);
      }
      .mark-on {
        color: var(--success-500);
        font-weight: 600;
      }
      .mark-off {
        color: var(--text-subtle);
      }
    `,
  ],
})
export class UsersComponent {
  private readonly account = inject(AccountService);
  private readonly entities = inject(EntitiesService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly users = signal<PublicUser[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly term = signal('');
  readonly sortSig = signal<{ field: string; order: 'asc' | 'desc' } | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly activeTab = signal('accounts');

  readonly dialogOpen = signal(false);
  readonly saving = signal(false);
  readonly editingUser = signal<PublicUser | null>(null);
  readonly editing = computed(() => this.editingUser() !== null);
  readonly deleteOpen = signal(false);
  readonly deleting = signal(false);
  readonly pendingDelete = signal<PublicUser | null>(null);

  readonly matrix = signal<PermissionMatrix | null>(null);
  readonly matrixLoading = signal(false);

  readonly tabs = computed(() => [
    { id: 'accounts', label: this.translate.instant('admin.users.tabs.accounts'), icon: 'users' as const },
    { id: 'matrix', label: this.translate.instant('admin.users.tabs.matrix'), icon: 'shield' as const },
  ]);

  readonly roleList = computed(() => ROLES);
  readonly entityList = computed(() => ENTITY_KEYS);
  protected readonly actionList = ACTIONS;

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    role: ['PATIENT' as Role, Validators.required],
    locale: ['fr', Validators.required],
    active: [true],
    linkedId: [''],
    password: ['', [Validators.required, Validators.minLength(8), Validators.pattern('(?=.*[a-zA-Z])(?=.*[0-9]).{8,}')]],
  });
  private readonly selectedRole = signal<Role>('PATIENT');

  readonly linkedEntity = computed<EntityKey | null>(() => {
    const role = this.selectedRole();
    if (role === 'PATIENT') return 'patients';
    if (role === 'DOCTOR') return 'doctors';
    return null;
  });

  readonly linkedInitial = computed<Ref | null>(() => {
    const user = this.editingUser();
    if (!user?.linkedId || !this.linkedEntity()) return null;
    return { id: user.linkedId, iri: '', label: user.linkedId, type: this.linkedEntity() ?? '' };
  });

  /** The picker depends on the chosen role: patients for PATIENT, doctors for DOCTOR. */
  readonly linkedSearch = (term: string): Observable<Ref[]> =>
    this.entities.refs(this.linkedEntity() ?? 'patients', term);

  readonly subtitle = computed(() =>
    this.translate.instant('admin.users.subtitle', { count: this.users().length }),
  );

  readonly columns = computed<TableColumn<PublicUser>[]>(() => [
    { field: 'fullName', header: this.translate.instant('admin.users.columns.fullName'), sortable: true },
    { field: 'email', header: this.translate.instant('admin.users.columns.email'), sortable: true },
    { field: 'role', header: this.translate.instant('admin.users.columns.role'), sortable: true },
    { field: 'linkedId', header: this.translate.instant('admin.users.columns.linked') },
    { field: 'active', header: this.translate.instant('admin.users.columns.active'), align: 'center' },
    { field: 'lastLoginAt', header: this.translate.instant('admin.users.columns.lastLogin'), sortable: true },
    { field: 'createdAt', header: this.translate.instant('admin.users.columns.created'), sortable: true },
  ]);

  readonly filtered = computed<PublicUser[]>(() => {
    const term = this.term().trim().toLowerCase();
    const all = this.users();
    if (!term) return all;
    return all.filter((user) =>
      [user.fullName, user.email, user.role, user.linkedId ?? ''].some((value) =>
        value.toLowerCase().includes(term),
      ),
    );
  });

  readonly sorted = computed<PublicUser[]>(() => {
    const sort = this.sortSig();
    const rows = [...this.filtered()];
    if (!sort) return rows;
    return rows.sort((a, b) => compareUsers(a, b, sort.field) * (sort.order === 'asc' ? 1 : -1));
  });

  readonly paged = computed<PublicUser[]>(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.sorted().slice(start, start + this.pageSize());
  });

  readonly deleteMessage = computed(() => {
    const user = this.pendingDelete();
    return user ? this.translate.instant('admin.users.deleteMessage', { email: user.email }) : null;
  });

  protected readonly skeletonRows = ['1', '2', '3', '4', '5'];

  constructor() {
    this.form
      .get('role')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((role) => {
        if (role) this.selectedRole.set(role);
        this.applyLinkedRequirement();
      });
    this.load();
    this.loadMatrix();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.account.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.users.set(res.items);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.loading.set(false);
      },
    });
  }

  loadMatrix(): void {
    this.matrixLoading.set(true);
    this.account.matrix().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (matrix) => {
        this.matrix.set(matrix);
        this.matrixLoading.set(false);
      },
      error: () => this.matrixLoading.set(false),
    });
  }

  roleOptions(): { value: string; label: string }[] {
    return ROLES.map((role) => ({ value: role, label: this.roleLabel(role) }));
  }

  localeOptions(): { value: string; label: string }[] {
    return [
      { value: 'fr', label: this.translate.instant('admin.users.localeOption.fr') },
      { value: 'en', label: this.translate.instant('admin.users.localeOption.en') },
    ];
  }

  roleLabel(role: Role): string {
    return labelOf(this.translate, `admin.users.role.${role}`, role);
  }

  roleKind(role: Role): BadgeKind {
    if (role === 'ADMIN') return 'info';
    if (role === 'DOCTOR') return 'success';
    if (role === 'RECEPTIONIST') return 'warning';
    return 'neutral';
  }

  entityLabel(entity: EntityKey): string {
    return labelOf(this.translate, `admin.users.entity.${entity}`, entity);
  }

  aria(key: string, name: string): string {
    return this.translate.instant(key, { name });
  }

  absolute(value: string | null): string {
    return value ? formatDateTime(value, this.lang()) : this.translate.instant('common.notSet');
  }

  allowed(role: Role, entity: EntityKey, action: (typeof ACTIONS)[number]): boolean {
    return (this.matrix()?.matrix[role]?.[entity] ?? []).includes(action);
  }

  matrixCell(role: Role, entity: EntityKey): string {
    const actions = (this.matrix()?.matrix[role]?.[entity] ?? []).map((action) =>
      labelOf(this.translate, `admin.users.matrix.action.${action}`, action),
    );
    const params = { role: this.roleLabel(role), entity: this.entityLabel(entity), actions: actions.join(', ') };
    return actions.length > 0
      ? this.translate.instant('admin.users.matrix.allowed', params)
      : this.translate.instant('admin.users.matrix.denied', params);
  }

  actionLetter(action: (typeof ACTIONS)[number]): string {
    return labelOf(this.translate, `admin.users.matrix.action.${action}`, action)[0]!.toUpperCase();
  }

  openCreate(): void {
    this.editingUser.set(null);
    this.form.reset({
      email: '',
      fullName: '',
      role: 'PATIENT',
      locale: this.lang(),
      active: true,
      linkedId: '',
      password: '',
    });
    this.form.get('password')?.enable();
    this.applyLinkedRequirement();
    this.dialogOpen.set(true);
  }

  openEdit(user: PublicUser): void {
    this.editingUser.set(user);
    this.form.reset({
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      locale: user.locale,
      active: user.active,
      linkedId: user.linkedId ?? '',
      password: '',
    });
    // the password is a create-only field: it is never shown again on edit
    this.form.get('password')?.disable();
    this.applyLinkedRequirement();
    this.dialogOpen.set(true);
  }

  closeModal(): void {
    this.dialogOpen.set(false);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error(this.translate.instant('admin.users.fixFields'));
      return;
    }
    const value = this.form.getRawValue();
    const current = this.editingUser();
    this.saving.set(true);
    const request: Observable<PublicUser> = current
      ? this.account.update(current.id, {
          email: value.email,
          fullName: value.fullName,
          role: value.role,
          locale: value.locale,
          active: value.active,
          linkedId: this.linkedEntity() ? (value.linkedId || null) : null,
        })
      : this.account.create({
          email: value.email,
          fullName: value.fullName,
          role: value.role,
          locale: value.locale,
          linkedId: value.linkedId || null,
          password: value.password,
        });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.users.update((list) =>
          current ? list.map((u) => (u.id === saved.id ? saved : u)) : [...list, saved],
        );
        this.dialogOpen.set(false);
        this.toast.success(
          this.translate.instant(current ? 'admin.users.updated' : 'admin.users.created'),
          saved.email,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.toast.error(this.translate.instant('common.operationFailed'), this.problemMessage(err));
      },
    });
  }

  toggleActive(user: PublicUser): void {
    this.account
      .update(user.id, { active: !user.active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));
          this.toast.success(
            this.translate.instant(updated.active ? 'admin.users.activated' : 'admin.users.deactivated'),
            updated.email,
          );
        },
        error: (err: HttpErrorResponse) =>
          this.toast.error(this.translate.instant('common.operationFailed'), this.problemMessage(err)),
      });
  }

  askDelete(user: PublicUser): void {
    this.pendingDelete.set(user);
    this.deleteOpen.set(true);
  }

  confirmDelete(): void {
    const user = this.pendingDelete();
    if (!user) return;
    this.deleting.set(true);
    this.account.remove(user.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.users.update((list) => list.filter((u) => u.id !== user.id));
        this.toast.success(this.translate.instant('admin.users.deleted'), user.email);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        // the API refuses deleting your own account: surface its exact message
        const message = this.problemMessage(err);
        this.toast.error(message || this.translate.instant('common.operationFailed'), message);
        if (message) this.deleteOpen.set(false);
      },
    });
  }

  onSort(sort: { field: string; order: 'asc' | 'desc' } | null): void {
    this.sortSig.set(sort);
    this.page.set(1);
  }

  onPage(page: number): void {
    this.page.set(page);
  }

  private applyLinkedRequirement(): void {
    const control = this.form.get('linkedId');
    if (!control) return;
    if (this.linkedEntity()) {
      control.setValidators([Validators.required]);
    } else {
      control.clearValidators();
      control.setValue('');
    }
    control.updateValueAndValidity();
  }

  private problemMessage(err: HttpErrorResponse): string {
    const problem = err.error as ApiProblem | undefined;
    return problem?.message ?? '';
  }

  private lang(): 'fr' | 'en' {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }
}

function compareUsers(a: PublicUser, b: PublicUser, field: string): number {
  const left = a[field as keyof PublicUser];
  const right = b[field as keyof PublicUser];
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  const l = left === null || left === undefined ? '' : String(left).toLowerCase();
  const r = right === null || right === undefined ? '' : String(right).toLowerCase();
  return l.localeCompare(r);
}
