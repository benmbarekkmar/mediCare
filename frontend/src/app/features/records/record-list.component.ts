import type { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EntitiesService, MetaService } from '../../core/api/entity.service';
import { AuthService } from '../../core/auth/auth.service';
import type { EntityInput, EntityKey, EntityMeta, Individual, Page, Ref } from '../../core/api/models';
import { UrlListState, type ListParams } from '../../core/util/list-state';
import { labelOf } from '../../core/util/labels';

import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiFilterBarComponent, type FilterSpec } from '../../shared/ui/filter-bar/ui-filter-bar.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiModalComponent } from '../../shared/ui/modal/ui-modal.component';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiTableComponent, UiCellDirective, UiRowActionsDirective, type TableColumn } from '../../shared/ui/table/ui-table.component';
import { EntityFormComponent } from './entity-form.component';
import { ToastService } from '../../core/toast/toast.service';

/**
 * One screen for all ten collections. Everything the table shows, filters and
 * accepts is read from `EntityMeta`, so the ontology is the only place a field
 * is defined.
 */
@Component({
  selector: 'record-list',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    UiPageHeaderComponent,
    UiCardComponent,
    UiButtonComponent,
    UiIconComponent,
    UiFilterBarComponent,
    UiTableComponent,
    UiCellDirective,
    UiRowActionsDirective,
    UiModalComponent,
    UiConfirmDialogComponent,
    UiErrorStateComponent,
    EntityFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './record-list.component.html',
  styleUrls: ['./record-list.component.scss'],
})
export class RecordListComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly entities = inject(EntitiesService);
  private readonly meta = inject(MetaService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected state: UrlListState;
  private readonly stateVersion = signal(0);
  private requestGeneration = 0;
  protected readonly page = signal<Page<Individual> | null>(null);
  protected readonly loading = signal(true);
  protected readonly metaLoading = signal(true);
  protected readonly metaLoadError = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Individual | null>(null);
  protected readonly saving = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly target = signal<Individual | null>(null);
  protected readonly dependents = signal<{ entity: string; id: string; label: string; predicate: string }[]>([]);
  protected readonly reassignOptions = signal<Ref[] | null>(null);
  protected readonly reassignTo = signal<string | null>(null);

  constructor() {
    const key = this.route.snapshot.paramMap.get('entity') ?? 'patients';
    this.entityKey.set(key as EntityKey);
    this.state = new UrlListState(this.route, this.router, `/records/${key}`, { pageSize: 20 });
    effect(
      () => {
        this.stateVersion();
        this.state.params();
        this.load();
      },
      { allowSignalWrites: true },
    );
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((map) => {
      const nextKey = map.get('entity') ?? 'patients';
      if (nextKey === this.entityKey()) return;
      this.entityKey.set(nextKey as EntityKey);
      this.page.set(null);
      this.loadError.set(null);
      this.formOpen.set(false);
      this.confirmOpen.set(false);
      this.state.destroy();
      this.state = new UrlListState(this.route, this.router, `/records/${nextKey}`, { pageSize: 20 });
      this.stateVersion.update((version) => version + 1);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((map) => {
      if (map.get('create') === '1') this.openCreateFromQuery();
    });
    this.loadMetadata();
  }

  /**
   * `?create=1` is how the dashboards hand a user straight to the form: the
   * create modal opens as soon as the entity metadata is in, and the parameter
   * is dropped from the URL when the modal closes.
   */
  protected loadMetadata(force = false): void {
    this.metaLoading.set(true);
    this.metaLoadError.set(false);
    this.meta.load(force).subscribe({
      next: () => this.metaLoading.set(false),
      error: () => {
        this.metaLoading.set(false);
        this.metaLoadError.set(true);
      },
    });
  }
  private openCreateFromQuery(): void {
    if (this.route.snapshot.queryParamMap.get('create') !== '1') return;
    // a deep link can land here while the matrix is still in flight: read it
    // first, otherwise `canCreate` would answer from an empty permission set
    const matrix: Observable<unknown> = this.auth.ready()
      ? of(null)
      : this.auth.loadMatrix().pipe(catchError(() => of(null)));
    matrix.subscribe(() => {
      this.meta.load().subscribe(() => {
        if (this.canCreate()) this.create();
      });
    });
  }

  ngOnDestroy(): void {
    this.state.destroy();
  }

  protected readonly entityKey = signal<EntityKey>('patients');
  protected readonly metaFor = computed<EntityMeta | null>(() => this.meta.entities().find((item) => item.key === this.entityKey()) ?? null);
  protected readonly title = computed(() => {
    const entity = this.entityKey();
    const fallback = this.metaFor()?.plural?.trim() || entity;
    return labelOf(this.translate, 'entities.' + entity + '.plural', fallback);
  });
  protected entityName(): string {
    const entity = this.entityKey();
    return labelOf(this.translate, 'entities.' + entity + '.singular', this.metaFor()?.label ?? entity);
  }
  protected readonly canCreate = computed(() => this.auth.can(this.entityKey(), 'create'));
  protected readonly canUpdate = computed(() => this.auth.can(this.entityKey(), 'update'));
  protected readonly canDelete = computed(() => this.auth.can(this.entityKey(), 'delete'));

  protected columns(): TableColumn<Individual>[] {
    const meta = this.metaFor();
    if (!meta) return [];
    const out: TableColumn<Individual>[] = [
      {
        field: meta.nameField,
        header: labelOf(this.translate, `entities.fields.${meta.nameField}`, meta.nameField),
        sortable: true,
        width: 'min(280px, 40%)',
        cellClass: 'weight-600',
      },
    ];
    for (const field of meta.data ?? []) {
      if (field.field === meta.nameField || out.length >= 6) continue;
      out.push({
        field: field.field,
        header: labelOf(this.translate, `entities.fields.${field.field}`, field.field),
        sortable: field.sortable,
        format: this.formatFor(field.datatype),
        width: field.datatype === 'boolean' ? '90px' : undefined,
      });
    }
    for (const relation of (meta.relations ?? []).slice(0, 2)) {
      if (out.length >= 7) break;
      out.push({
        field: relation.field,
        header: relation.targetLabel,
        sortable: false,
        cellClass: 'truncate',
        csv: (row) => this.relationLabel(row, relation.field),
      });
    }
    return out;
  }

  protected filters(): FilterSpec[] {
    const meta = this.metaFor();
    if (!meta) return [];
    const specs: FilterSpec[] = [
      { kind: 'search', label: this.translate.instant('common.search'), placeholder: this.translate.instant('nav.searchPlaceholder') },
    ];
    const facet = meta.typeFacet;
    const facetValues = Array.isArray(facet?.classes) ? facet.classes : [];
    if (facet?.filterParam && facetValues.length > 0) {
      specs.push({
        kind: 'select',
        field: facet.filterParam,
        label: labelOf(this.translate, `entities.fields.${facet.field}`, facet.label || this.translate.instant('form.section.type')),
        options: facetValues.map((value) => ({ value, label: labelOf(this.translate, `entities.values.${value}`, value) })),
      });
    }
    for (const field of meta.data ?? []) {
      if (!field.values?.length || specs.length >= 5) continue;
      specs.push({
        kind: 'select',
        field: field.field,
        label: labelOf(this.translate, `entities.fields.${field.field}`, field.field),
        options: field.values.map((value) => ({ value, label: labelOf(this.translate, `entities.values.${value}`, value) })),
      });
    }
    const dates: Partial<Record<EntityKey, boolean>> = { tests: true, appointments: true };
    if (dates[meta.key]) {
      specs.push({ kind: 'dateRange', fields: ['dateFrom', 'dateTo'], label: this.translate.instant('common.date') });
    }
    if (meta.key === 'appointments') specs.push({ kind: 'toggle', field: 'upcoming', label: this.translate.instant('common.upcoming') });
    if (meta.key === 'patients') {
      specs.push({
        kind: 'select',
        field: 'ageGroup',
        label: this.translate.instant('entities.ageGroup'),
        options: ['child', 'adult', 'elderly', 'chronic', 'emergency'].map((value) => ({ value, label: labelOf(this.translate, `entities.values.${value}`, value) })),
      });
      specs.push({ kind: 'range', fields: ['minAge', 'maxAge'], label: this.translate.instant('entities.age') });
    }
    for (const relation of meta.relations ?? []) {
      if (!relation.filterParam || specs.length >= 8) continue;
      specs.push({
        kind: 'entity',
        field: relation.filterParam,
        label: relation.targetLabel,
        entity: relation.target,
        optionLoader: (key: EntityKey) => this.entities.refs(key, undefined, 50),
      });
    }
    return specs;
  }

  protected get params(): ListParams {
    return this.state.params();
  }

  protected patch(next: Partial<ListParams>): void {
    this.state.patch(next);
  }

  protected clear(): void {
    this.state.clearAll();
  }

  protected load(): void {
    const params = this.state.params();
    const entity = this.entityKey();
    const request = ++this.requestGeneration;
    this.loading.set(true);
    this.loadError.set(null);
    const query: Record<string, string | number | boolean | null | undefined> = {
      page: params.page,
      pageSize: params.pageSize,
      sort: params.sort ?? undefined,
      order: params.order,
      q: params.q || undefined,
      ...params.filters,
    };
    this.entities.list(entity, query).subscribe({
      next: (page) => {
        if (request !== this.requestGeneration) return;
        this.page.set(page);
        this.loading.set(false);
      },
      error: (error: { status?: number; message?: string }) => {
        if (request !== this.requestGeneration) return;
        this.loading.set(false);
        this.loadError.set(error?.message ?? 'error');
      },
    });
  }

  protected onSort(next: { field: string; order: 'asc' | 'desc' }): void {
    this.state.setSort(next.field, next.order);
  }

  protected onPage(page: number): void {
    this.state.patch({ page });
  }

  protected onPageSize(size: number): void {
    this.state.patch({ pageSize: size });
  }

  protected open(row: Individual): void {
    void this.router.navigate([`/records/${this.entityKey()}/${row.id}`]);
  }

  protected create(): void {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  protected edit(row: Individual): void {
    this.editing.set(row);
    this.formOpen.set(true);
  }

  protected save(body: EntityInput): void {
    const key = this.entityKey();
    const current = this.editing();
    this.saving.set(true);
    const call: Observable<Individual> = current
      ? this.entities.update(key, current.id, body)
      : this.entities.create(key, body);
    call.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.closeForm();
        this.toast.success(
          this.translate.instant(current ? 'form.updated' : 'form.created', { entity: this.title() }),
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

  protected closeForm(): void {
    this.formOpen.set(false);
    this.clearCreateParam();
  }

  /** Keeps `?create=1` out of the address bar once the form has been used. */
  private clearCreateParam(): void {
    if (this.route.snapshot.queryParamMap.get('create') === null) return;
    void this.router.navigate([`/records/${this.entityKey()}`], {
      queryParams: this.state.toQuery(),
      replaceUrl: true,
    });
  }

  protected writableFor(): string[] | null {
    return this.auth.editableFields(this.entityKey());
  }

  protected askDelete(row: Individual): void {
    this.target.set(row);
    this.dependents.set([]);
    this.entities.dependents(this.entityKey(), row.id).subscribe({
      next: (report) => {
        this.dependents.set(report.dependents);
        this.confirmOpen.set(true);
      },
      error: () => this.confirmOpen.set(true),
    });
  }

  protected confirmDelete(): void {
    const row = this.target();
    if (!row) return;
    this.entities.remove(this.entityKey(), row.id, this.reassignTo() ?? undefined).subscribe({
      next: (result) => {
        this.confirmOpen.set(false);
        this.toast.success(this.translate.instant('common.deleted'), result.deleted ? `${row.label}` : '');
        this.load();
      },
      error: () => this.confirmOpen.set(false),
    });
  }

  protected relationLabel(row: Individual, field: string): string {
    const raw = row.relations[field];
    if (!raw) return '';
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((ref) => ref.label).join(', ');
  }

  protected formValue(): Individual | null {
    return this.editing();
  }

  private formatFor(datatype: string): TableColumn<Individual>['format'] {
    if (datatype === 'date') return 'date';
    if (datatype === 'dateTime') return 'datetime';
    if (datatype === 'boolean') return 'bool';
    return 'text';
  }
}
