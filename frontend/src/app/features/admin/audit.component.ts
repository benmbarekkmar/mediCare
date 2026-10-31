import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountService } from '../../core/api/account.service';
import { ENTITY_KEYS, type AuditEntry, type EntityKey } from '../../core/api/models';
import { ToastService } from '../../core/toast/toast.service';
import { UrlListState } from '../../core/util/list-state';
import { formatDateTime, relativeTime } from '../../core/util/format';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCodeBlockComponent } from '../../shared/ui/code-block/ui-code-block.component';
import { UiDrawerComponent } from '../../shared/ui/drawer/ui-drawer.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import {
  type FilterSpec,
  UiFilterBarComponent,
} from '../../shared/ui/filter-bar/ui-filter-bar.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import type { BadgeKind } from '../../shared/ui/badge/ui-badge.component';
import {
  type TableColumn,
  UiCellDirective,
  UiIconButtonComponent,
  UiRowActionsDirective,
  UiTableComponent,
} from '../../shared/ui/table/ui-table.component';

/** The fixed vocabulary written by backend/src/auth/audit.ts. */
const FIXED_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REFRESH',
  'PASSWORD_CHANGE',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_DELETE',
  'CREATE',
  'UPDATE',
  'DELETE',
  'SPARQL_QUERY',
  'SPARQL_UPDATE',
  'CONSISTENCY_REPAIR',
  'ONTOLOGY_LOAD',
  'NLP_ASK',
  'NLP_RELOAD',
] as const;

const API_LIMIT = 500;

/** ADMIN audit trail: who did what, with the recorded payload. */
@Component({
  selector: 'admin-audit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    RouterLink,
    UiAlertComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiCellDirective,
    UiCodeBlockComponent,
    UiDrawerComponent,
    UiErrorStateComponent,
    UiFilterBarComponent,
    UiIconButtonComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
    UiRowActionsDirective,
    UiSkeletonComponent,
    UiTableComponent,
  ],
  template: `
    <div class="page audit">
      <ui-page-header [title]="'admin.audit.title' | translate" [subtitle]="subtitle()" icon="clipboard-list">
        <ng-template uiPageActions>
          <ui-button variant="outline" icon="refresh" size="sm" [loading]="loading()" (click)="refresh()">
            {{ 'common.refresh' | translate }}
          </ui-button>
        </ng-template>
      </ui-page-header>

      @if (loadError()) {
        <ui-error-state
          [title]="'ui.error.title' | translate"
          [message]="'admin.audit.error.message' | translate"
          [hint]="'common.retry' | translate"
          (retry)="refresh()"
        />
      } @else {
        <ui-filter-bar
          [filters]="specs()"
          [values]="state.params()"
          (change)="state.patch($event)"
          (clear)="state.clearAll()"
        />

        @if (capped()) {
          <ui-alert kind="info" icon="info" [dismissible]="true" [title]="null">
            {{ 'admin.audit.limitHint' | translate }}
          </ui-alert>
        }

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
            [sort]="sortValue()"
            [page]="state.params().page"
            [pageSize]="state.params().pageSize"
            [trackId]="'id'"
            exportName="audit"
            [emptyTitle]="'admin.audit.empty.title' | translate"
            [emptyHint]="'admin.audit.empty.hint' | translate"
            [actionsLabel]="'common.actions' | translate"
            (sortChange)="onSort($event)"
            (pageChange)="onPage($event)"
          >
            <ng-template uiCell="createdAt" let-row="row">
              <span class="nowrap">{{ relative(row.createdAt) }}</span>
              <span class="absolute text-muted text-sm nowrap">{{ absolute(row.createdAt) }}</span>
            </ng-template>
            <ng-template uiCell="role" let-row="row">
              @if (row.role) {
                <ui-badge [kind]="roleKind(row.role)" [label]="text(row.role)"></ui-badge>
              } @else {
                <span class="text-muted">{{ 'common.notSet' | translate }}</span>
              }
            </ng-template>
            <ng-template uiCell="resourceId" let-row="row">
              @if (row.entity && isEntityKey(row.entity) && row.resourceId) {
                <a class="id-link" [routerLink]="['/records', row.entity, row.resourceId]">{{ row.resourceId }}</a>
              } @else if (row.resourceId) {
                <span class="font-mono resource">{{ row.resourceId }}</span>
              } @else {
                <span class="text-muted">·</span>
              }
            </ng-template>
            <ng-template uiCell="request" let-row="row">
              <span class="row-method font-mono">{{ row.method }}</span>
              @if (row.status) {
                <ui-badge [kind]="statusKind(row.status)" [label]="text(row.status)"></ui-badge>
              }
            </ng-template>
            <ng-template uiCell="path" let-row="row">
              <span class="font-mono truncate path">{{ row.path }}</span>
            </ng-template>
            <ng-template uiRowActions let-row="row">
              <ui-icon-button
                icon="eye"
                [label]="detailsLabel(row.id)"
                (click)="openDetails(row)"
              ></ui-icon-button>
            </ng-template>
          </ui-table>
        }
      }

      <ui-drawer
        [open]="detailsOpen()"
        (openChange)="detailsOpen.set($event)"
        [title]="'admin.audit.details' | translate"
        side="end"
        width="420px"
      >
        @if (selected(); as entry) {
          <dl class="details-list">
            <div class="details-row">
              <dt>{{ 'admin.audit.columns.action' | translate }}</dt>
              <dd>{{ entry.action }}</dd>
            </div>
            <div class="details-row">
              <dt>{{ 'admin.audit.who' | translate }}</dt>
              <dd>{{ entry.email ?? '—' }} · {{ entry.role ?? '—' }}</dd>
            </div>
            <div class="details-row">
              <dt>{{ 'admin.audit.absolute' | translate }}</dt>
              <dd>{{ absolute(entry.createdAt) }}</dd>
            </div>
          </dl>
          @if (detailsJson(entry); as json) {
            <ui-code-block language="json" [code]="json" [copyable]="true" [wrap]="true" />
          } @else {
            <p class="text-muted text-sm">{{ 'admin.audit.noDetails' | translate }}</p>
          }
        }
      </ui-drawer>
    </div>
  `,
  styles: [
    `
      .audit {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .table-skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .absolute {
        display: block;
      }
      .id-link {
        color: var(--primary);
        border-radius: var(--radius-input);
        transition: color var(--duration) var(--ease);
        word-break: break-all;
      }
      .id-link:hover {
        color: var(--primary-hover);
        text-decoration: underline;
      }
      .id-link:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .resource,
      .path {
        font-size: var(--fs-xs);
        word-break: break-all;
        max-width: 100%;
      }
      .row-method {
        margin-inline-end: var(--sp-2);
        font-size: var(--fs-xs);
      }
      .details-list {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
        margin: 0 0 var(--sp-4);
      }
      .details-row dt {
        color: var(--text-muted);
        font-size: var(--fs-xs);
      }
      .details-row dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class AuditComponent {
  private readonly account = inject(AccountService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = new UrlListState(inject(ActivatedRoute), inject(Router), '/admin/audit');

  readonly entries = signal<AuditEntry[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly detailsOpen = signal(false);
  readonly selected = signal<AuditEntry | null>(null);

  protected readonly skeletonRows = ['1', '2', '3', '4', '5', '6'];

  readonly subtitle = computed(() =>
    this.translate.instant('admin.audit.subtitle', { count: this.entries().length }),
  );

  readonly capped = computed(() => this.entries().length >= API_LIMIT);

  /** Selects offered: the fixed backend vocabulary plus anything present in the payload. */
  readonly actionOptions = computed(() => {
    const seen = new Set<string>(FIXED_ACTIONS);
    for (const entry of this.entries()) seen.add(entry.action);
    return [...seen].map((action) => ({ value: action, label: action }));
  });

  readonly entityOptions = computed(() => {
    const seen = new Set<string>(ENTITY_KEYS);
    for (const entry of this.entries()) if (entry.entity) seen.add(entry.entity);
    return [...seen].map((entity) => ({ value: entity, label: entity }));
  });

  readonly specs = computed<FilterSpec[]>(() => [
    {
      kind: 'search',
      label: this.translate.instant('admin.audit.filters.search'),
      placeholder: this.translate.instant('admin.audit.searchPlaceholder'),
    },
    {
      kind: 'select',
      field: 'action',
      label: this.translate.instant('admin.audit.filters.action'),
      options: this.actionOptions(),
    },
    {
      kind: 'select',
      field: 'entity',
      label: this.translate.instant('admin.audit.filters.entity'),
      options: this.entityOptions(),
    },
    {
      kind: 'dateRange',
      fields: ['dateFrom', 'dateTo'],
      label: this.translate.instant('admin.audit.filters.period'),
    },
  ]);

  /** The server narrows on action and entity; the rest of the filters are client side. */
  private readonly serverFilters = computed(() => {
    const filters = this.state.params().filters;
    return { action: filters['action'] ?? null, entity: filters['entity'] ?? null };
  });

  readonly filtered = computed<AuditEntry[]>(() => {
    const params = this.state.params();
    const term = params.q.trim().toLowerCase();
    const from = params.filters['dateFrom'];
    const to = params.filters['dateTo'];
    let rows = this.entries();
    if (term) {
      rows = rows.filter((entry) =>
        [entry.path ?? '', entry.email ?? ''].some((value) => value.toLowerCase().includes(term)),
      );
    }
    if (from) {
      const start = new Date(`${from}T00:00:00`).getTime();
      rows = rows.filter((entry) => new Date(entry.createdAt).getTime() >= start);
    }
    if (to) {
      const end = new Date(`${to}T23:59:59.999`).getTime();
      rows = rows.filter((entry) => new Date(entry.createdAt).getTime() <= end);
    }
    const sort = params.sort;
    if (sort) {
      const direction = params.order === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => compareEntries(a, b, sort) * direction);
    }
    return rows;
  });

  readonly paged = computed<AuditEntry[]>(() => {
    const { page, pageSize } = this.state.params();
    return this.filtered().slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  });

  readonly sortValue = computed(() => {
    const { sort, order } = this.state.params();
    return sort ? { field: sort, order } : null;
  });

  readonly columns = computed<TableColumn<AuditEntry>[]>(() => [
    {
      field: 'createdAt',
      header: this.translate.instant('admin.audit.columns.when'),
      sortable: true,
      csv: (row) => String(row['createdAt'] ?? ''),
    },
    {
      field: 'email',
      header: this.translate.instant('admin.audit.columns.email'),
      sortable: true,
      csv: (row) => String(row['email'] ?? ''),
    },
    {
      field: 'role',
      header: this.translate.instant('admin.audit.columns.role'),
      csv: (row) => String(row['role'] ?? ''),
    },
    {
      field: 'action',
      header: this.translate.instant('admin.audit.columns.action'),
      sortable: true,
      csv: (row) => String(row['action'] ?? ''),
    },
    {
      field: 'entity',
      header: this.translate.instant('admin.audit.columns.entity'),
      csv: (row) => String(row['entity'] ?? ''),
    },
    {
      field: 'resourceId',
      header: this.translate.instant('admin.audit.columns.resource'),
      csv: (row) => String(row['resourceId'] ?? ''),
    },
    {
      field: 'request',
      header: this.translate.instant('admin.audit.columns.request'),
      width: '12rem',
      csv: (row) => `${String(row['method'] ?? '')} ${String(row['status'] ?? '')}`.trim(),
    },
    {
      field: 'path',
      header: this.translate.instant('admin.audit.columns.path'),
      cellClass: 'truncate',
      csv: (row) => String(row['path'] ?? ''),
    },
  ]);

  constructor() {
    effect(
      () => {
        this.serverFilters();
        this.load();
      },
      { allowSignalWrites: true },
    );
  }

  load(announce = false): void {
    this.loading.set(true);
    this.loadError.set(false);
    const filters = this.serverFilters();
    this.account
      .audit({ limit: API_LIMIT, action: filters.action ?? undefined, entity: filters.entity ?? undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.entries.set(res.items);
          this.loading.set(false);
          if (announce) this.toast.success(this.translate.instant('admin.audit.refreshed'));
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
          if (announce) this.toast.error(this.translate.instant('ui.error.title'));
        },
      });
  }

  refresh(): void {
    this.load(true);
  }

  onSort(sort: { field: string; order: 'asc' | 'desc' } | null): void {
    this.state.setSort(sort?.field ?? null, sort?.order ?? 'asc');
  }

  onPage(page: number): void {
    this.state.patch({ page });
  }

  isEntityKey(value: string): value is EntityKey {
    return (ENTITY_KEYS as readonly string[]).includes(value);
  }

  detailsLabel(id: number): string {
    return this.translate.instant('admin.audit.openDetails', { id });
  }

  text(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  relative(value: string): string {
    return relativeTime(value, this.lang());
  }

  absolute(value: string): string {
    return formatDateTime(value, this.lang());
  }

  roleKind(role: string): BadgeKind {
    if (role === 'ADMIN') return 'info';
    if (role === 'DOCTOR') return 'success';
    if (role === 'RECEPTIONIST') return 'warning';
    return 'neutral';
  }

  statusKind(status: number): BadgeKind {
    if (status < 300) return 'success';
    if (status < 400) return 'info';
    if (status < 500) return 'warning';
    return 'danger';
  }

  detailsJson(entry: AuditEntry): string | null {
    if (!entry.details) return null;
    try {
      return JSON.stringify(JSON.parse(entry.details), null, 2);
    } catch {
      return entry.details;
    }
  }

  openDetails(entry: AuditEntry): void {
    this.selected.set(entry);
    this.detailsOpen.set(true);
  }

  private lang(): 'fr' | 'en' {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }
}

function compareEntries(a: AuditEntry, b: AuditEntry, field: string): number {
  const left = a[field as keyof AuditEntry];
  const right = b[field as keyof AuditEntry];
  const l = left === null || left === undefined ? '' : String(left);
  const r = right === null || right === undefined ? '' : String(right);
  return l.localeCompare(r);
}
