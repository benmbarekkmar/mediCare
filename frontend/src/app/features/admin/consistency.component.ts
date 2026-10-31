import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ConsistencyService } from '../../core/api/insight.service';
import { OntologyService } from '../../core/api/ontology.service';
import type { ApiProblem, ConsistencyCheck, ConsistencyReport, OntologyStats } from '../../core/api/models';
import { ToastService } from '../../core/toast/toast.service';
import { formatDateTime } from '../../core/util/format';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiCardActionsDirective } from '../../shared/ui/card/ui-card.component';
import { UiCodeBlockComponent } from '../../shared/ui/code-block/ui-code-block.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';

/** Violation rows as served: the OpenAPI type says `s`, the running API sends `subject`. */
type ViolationRow = { s?: string; subject?: string; detail?: string };

/** The individual id prefixes that can be resolved to a record route. */
const ID_PREFIX_TO_ENTITY: ReadonlyMap<string, string> = new Map<string, string>([
  ['Patient', 'patients'],
  ['Doctor', 'doctors'],
  ['Appointment', 'appointments'],
  ['Test', 'tests'],
  ['Disease', 'diseases'],
  ['Symptom', 'symptoms'],
  ['Treatment', 'treatments'],
  ['Medication', 'medications'],
  ['Hospital', 'hospitals'],
  ['Department', 'departments'],
]);

/** ADMIN axiom audit: what breaks the TBox contract and how to fix it. */
@Component({
  selector: 'admin-consistency',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    RouterLink,
    UiAlertComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiCardActionsDirective,
    UiCodeBlockComponent,
    UiConfirmDialogComponent,
    UiErrorStateComponent,
    UiIconComponent,
    UiSkeletonComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
  ],
  template: `
    <div class="page consistency">
      <ui-page-header [title]="'admin.consistency.title' | translate" [subtitle]="subtitle()" icon="shield">
        <ng-template uiPageActions>
          <ui-button variant="outline" icon="refresh" size="sm" [loading]="loading()" (click)="refresh()">
            {{ 'common.refresh' | translate }}
          </ui-button>
          @if (report(); as r) {
            <ui-button icon="wand" (click)="askRepair()" [disabled]="r.violations === 0">
              {{ 'admin.consistency.repair' | translate }}
            </ui-button>
          }
        </ng-template>
      </ui-page-header>

      @if (stats(); as s) {
        <section class="stats-strip" [attr.aria-label]="'admin.consistency.stats.title' | translate">
          @for (item of statItems(s); track item.label) {
            <div class="stat">
              <span class="stat-value">{{ item.value }}</span>
              <span class="stat-label">{{ item.label }}</span>
            </div>
          }
        </section>
      }

      @if (loadError()) {
        <ui-error-state
          [title]="'ui.error.title' | translate"
          [message]="'admin.consistency.error.message' | translate"
          [hint]="'common.retry' | translate"
          (retry)="refresh()"
        />
      } @else if (loading()) {
        <div class="skeletons" aria-busy="true" [attr.aria-label]="'admin.consistency.loading' | translate">
          <ui-skeleton height="72px" [radius]="'var(--radius-card)'"></ui-skeleton>
          @for (c of skeletonChecks; track c) {
            <ui-skeleton height="220px" [radius]="'var(--radius-card)'"></ui-skeleton>
          }
        </div>
      } @else {
        @if (report(); as r) {
        <ui-alert
          [kind]="r.ok ? 'success' : 'danger'"
          [dismissible]="false"
          [title]="r.ok ? ('admin.consistency.summary.ok' | translate) : null"
        >
          @if (!r.ok) {
            {{
              'admin.consistency.summary.violations'
                | translate: { violations: r.violations, fixable: r.fixable }
            }}
          }
        </ui-alert>

        @for (check of r.checks; track check.id) {
          <ui-card [title]="check.title" [subtitle]="axiomLine(check)" icon="git-branch">
            <ng-template uiCardActions>
              @if (check.count > 0) {
                <ui-badge kind="danger" [label]="violationCount(check)"></ui-badge>
              } @else {
                <ui-badge kind="success" [dot]="true" [label]="('admin.consistency.check.passed' | translate)"></ui-badge>
              }
            </ng-template>

            @if (check.count > 0) {
              <ul class="violations">
                @for (v of check.violations; track violationId(v)) {
                  <li class="violation">
                    @if (recordPath(v); as path) {
                      <a class="id-link font-mono" [routerLink]="path">{{ violationId(v) }}</a>
                    } @else {
                      <span class="font-mono">{{ violationId(v) }}</span>
                    }
                    @if (v.detail) {
                      <span class="violation-detail text-muted text-sm">{{ v.detail }}</span>
                    }
                  </li>
                }
              </ul>
              <p class="fix">
                <span class="fix-label weight-600">{{ 'admin.consistency.check.fix' | translate }}</span>
                {{ fixText(check) }}
              </p>
            }

            <div class="query-block">
              <button
                type="button"
                class="query-toggle"
                [attr.aria-expanded]="isQueryOpen(check.id)"
                (click)="toggleQuery(check.id)"
              >
                <ui-icon [name]="isQueryOpen(check.id) ? 'chevron-down' : 'chevron-right'" [size]="16" />
                {{ 'admin.consistency.check.query' | translate }}
              </button>
              @if (isQueryOpen(check.id)) {
                <ui-code-block language="sparql" [code]="check.query" [copyable]="true" />
              }
            </div>
          </ui-card>
        }
        }
      }

      <ui-confirm-dialog
        [open]="repairOpen()"
        (openChange)="repairOpen.set($event)"
        [title]="'admin.consistency.repairTitle' | translate"
        [message]="'admin.consistency.repairMessage' | translate"
        [confirmLabel]="('admin.consistency.repair' | translate)"
        [danger]="true"
        [busy]="repairing()"
        (confirmed)="runRepair()"
      />
    </div>
  `,
  styles: [
    `
      .consistency {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .stats-strip {
        display: grid;
        gap: var(--sp-3);
        grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        padding: var(--sp-3) var(--sp-4);
      }
      .stat {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .stat-value {
        font-size: var(--fs-lg);
        font-weight: 600;
        color: var(--text);
      }
      .stat-label {
        font-size: var(--fs-xs);
        color: var(--text-muted);
      }
      .skeletons {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .violations {
        list-style: none;
        margin: 0 0 var(--sp-3);
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
      .violation {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--sp-2);
        min-width: 0;
      }
      .violation-detail {
        overflow-wrap: anywhere;
      }
      .fix {
        margin: 0 0 var(--sp-3);
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .fix-label {
        color: var(--text);
        margin-inline-end: var(--sp-2);
      }
      .query-block {
        margin-top: var(--sp-2);
      }
      .query-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        background: none;
        border: 0;
        padding: var(--sp-1) var(--sp-1);
        border-radius: var(--radius-input);
        color: var(--primary);
        font: inherit;
        font-size: var(--fs-sm);
        cursor: pointer;
        transition: color var(--duration) var(--ease);
      }
      .query-toggle:hover {
        color: var(--primary-hover);
      }
      .query-toggle:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .id-link {
        color: var(--primary);
        border-radius: var(--radius-input);
        transition: color var(--duration) var(--ease);
        overflow-wrap: anywhere;
      }
      .id-link:hover {
        color: var(--primary-hover);
        text-decoration: underline;
      }
      .id-link:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
    `,
  ],
})
export class ConsistencyComponent {
  private readonly consistency = inject(ConsistencyService);
  private readonly ontology = inject(OntologyService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly report = signal<ConsistencyReport | null>(null);
  readonly stats = signal<OntologyStats | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly repairOpen = signal(false);
  readonly repairing = signal(false);
  readonly openQueries = signal<ReadonlySet<string>>(new Set());

  protected readonly skeletonChecks = ['1', '2', '3'];

  readonly subtitle = computed(() => {
    const checkedAt = this.report()?.checkedAt;
    return checkedAt
      ? this.translate.instant('admin.consistency.subtitle', { time: formatDateTime(checkedAt, this.lang()) })
      : null;
  });

  constructor() {
    this.load();
    this.ontology
      .stats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (s) => this.stats.set(s), error: () => undefined });
  }

  load(announce = false): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.consistency
      .check()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
          if (announce) this.toast.success(this.translate.instant('admin.consistency.refreshed'));
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

  askRepair(): void {
    const r = this.report();
    if (!r || r.violations === 0) {
      this.toast.info(this.translate.instant('admin.consistency.nothingToRepair'));
      return;
    }
    this.repairOpen.set(true);
  }

  runRepair(): void {
    this.repairing.set(true);
    this.consistency
      .repair()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.repairing.set(false);
          this.repairOpen.set(false);
          this.toast.success(
            this.translate.instant('admin.consistency.repaired', { operations: res.operations }),
          );
          // the repair writes to the store: re-run the checks to show the new truth
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.repairing.set(false);
          const problem = err.error as ApiProblem | undefined;
          this.toast.error(
            this.translate.instant('common.operationFailed'),
            problem?.message ?? this.translate.instant('errors.UNKNOWN'),
          );
        },
      });
  }

  axiomLine(check: ConsistencyCheck): string {
    return `${this.translate.instant('admin.consistency.check.axiom')}: ${check.axiom}`;
  }

  violationCount(check: ConsistencyCheck): string {
    return this.translate.instant('admin.consistency.check.violationsCount', { count: check.count });
  }

  violationId(v: ViolationRow): string {
    return v.s ?? v.subject ?? '';
  }

  /** Maps an individual id to its record route when the entity can be inferred. */
  recordPath(v: ViolationRow): string | null {
    const id = this.violationId(v).replace(/^(:|ont:)/, '');
    const separator = id.search(/[^A-Za-z]/);
    const prefix = id.slice(0, separator === -1 ? id.length : separator);
    const entity = ID_PREFIX_TO_ENTITY.get(prefix);
    return entity ? `/records/${entity}/${id}` : null;
  }

  fixText(check: ConsistencyCheck): string {
    const fix = (check.fix ?? '').trim();
    return fix ? fix : this.translate.instant('admin.consistency.check.manualFix');
  }

  isQueryOpen(id: string): boolean {
    return this.openQueries().has(id);
  }

  toggleQuery(id: string): void {
    this.openQueries.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected statItems(s: OntologyStats): { label: string; value: string }[] {
    const t = (key: string): string => this.translate.instant(`admin.consistency.stats.${key}`);
    const individuals = Object.values(s.individualsByEntity ?? {}).reduce((a, b) => a + b, 0);
    return [
      { label: t('triples'), value: s.triples.toLocaleString() },
      { label: t('classes'), value: s.classes.toLocaleString() },
      { label: t('objectProperties'), value: s.objectProperties.toLocaleString() },
      { label: t('datatypeProperties'), value: s.datatypeProperties.toLocaleString() },
      { label: t('namedIndividuals'), value: s.namedIndividuals.toLocaleString() },
      { label: t('individuals'), value: individuals.toLocaleString() },
    ];
  }

  private lang(): 'fr' | 'en' {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }
}
