import type { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EntitiesService, MetaService } from '../../core/api/entity.service';
import { AuthService } from '../../core/auth/auth.service';
import { BreadcrumbsService } from '../../layout/breadcrumbs.service';
import type { EntityInput, EntityKey, EntityMeta, Individual, Ref } from '../../core/api/models';
import { formatDateTime } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiModalComponent } from '../../shared/ui/modal/ui-modal.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { EntityFormComponent } from './entity-form.component';
import { ToastService } from '../../core/toast/toast.service';

interface FieldRow {
  field: string;
  label: string;
  value: string;
  empty: boolean;
}

interface RelationRow {
  entity: EntityKey;
  label: string;
  items: Ref[];
}

/** The individual view: asserted data, the graph around it, and the write actions. */
@Component({
  selector: 'record-detail',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    UiCardComponent,
    UiButtonComponent,
    UiBadgeComponent,
    UiIconComponent,
    UiModalComponent,
    UiConfirmDialogComponent,
    UiSkeletonComponent,
    UiErrorStateComponent,
    EntityFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './record-detail.component.html',
  styleUrls: ['./record-detail.component.scss'],
})
export class RecordDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly entities = inject(EntitiesService);
  private readonly metaService = inject(MetaService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly crumbs = inject(BreadcrumbsService);

  protected readonly entityKey = signal<EntityKey>((this.route.snapshot.paramMap.get('entity') ?? 'patients') as EntityKey);
  protected readonly row = signal<Individual | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly dependents = signal<{ entity: string; id: string; label: string; predicate: string }[]>([]);
  protected readonly reassignTo = signal<string | null>(null);

  protected readonly meta = computed<EntityMeta | null>(
    () => this.metaService.entities().find((item) => item.key === this.entityKey()) ?? null,
  );

  constructor() {
    this.route.paramMap.subscribe((map) => {
      this.entityKey.set((map.get('entity') ?? this.entityKey()) as EntityKey);
      this.load();
    });
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.loading.set(true);
    this.failed.set(false);
    this.entities.get(this.entityKey(), id).subscribe({
      next: (row) => {
        this.row.set(row);
        this.loading.set(false);
        this.crumbs.setTail(row.label);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  protected get fieldRows(): FieldRow[] {
    const row = this.row();
    const meta = this.meta();
    if (!row || !meta) return [];
    const lang = this.translate.currentLang ?? 'en';
    return meta.data.map((field) => {
      const raw = row.fields[field.field];
      const empty = raw === null || raw === undefined || raw === '';
      let value = '';
      if (!empty) {
        if (field.datatype === 'date' || field.datatype === 'dateTime') value = formatDateTime(String(raw), lang);
        else if (field.datatype === 'boolean') value = this.translate.instant(raw ? 'uipage.yes' : 'uipage.no');
        else if (field.values) value = labelOf(this.translate, `entities.values.${String(raw)}`, String(raw));
        else value = String(raw);
      }
      return { field: field.field, label: this.fieldLabel(field.field), value, empty };
    });
  }

  protected get relationRows(): RelationRow[] {
    const row = this.row();
    const meta = this.meta();
    if (!row || !meta) return [];
    const out: RelationRow[] = [];
    const seen = new Set<string>();
    for (const relation of meta.relations) {
      const raw = row.relations[relation.field];
      if (!raw || seen.has(relation.field)) continue;
      seen.add(relation.field);
      out.push({
        entity: relation.target,
        label: relation.targetLabel,
        items: (Array.isArray(raw) ? raw : [raw]).map((ref) => ref as unknown as Ref),
      });
    }
    for (const [key, raw] of Object.entries(row.relations)) {
      if (seen.has(key) || !raw) continue;
      out.push({
        entity: this.entityKey(),
        label: labelOf(this.translate, `entities.relations.${key}`, key),
        items: (Array.isArray(raw) ? raw : [raw]).map((ref) => ref as unknown as Ref),
      });
    }
    return out;
  }

  protected fieldLabel(field: string): string {
    return labelOf(this.translate, `entities.fields.${field}`, field);
  }

  protected href(entity: EntityKey, id: string): string {
    return this.auth.role() === 'PATIENT' ? `/patient/record` : `/records/${entity}/${encodeURIComponent(id)}`;
  }

  protected get canUpdate(): boolean {
    return this.auth.can(this.entityKey(), 'update');
  }

  protected get canDelete(): boolean {
    return this.auth.can(this.entityKey(), 'delete');
  }

  protected entityName(): string {
    const entity = this.entityKey();
    const meta = this.meta();
    return labelOf(this.translate, 'entities.' + entity + '.singular', meta?.label ?? entity);
  }

  protected get writable(): string[] | null {
    return this.auth.editableFields(this.entityKey());
  }

  protected openEdit(): void {
    this.formOpen.set(true);
  }

  protected save(body: EntityInput): void {
    const row = this.row();
    if (!row) return;
    this.saving.set(true);
    this.entities.update(this.entityKey(), row.id, body).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.row.set(saved);
        this.toast.success(this.translate.instant('form.updated', { entity: this.entityName() }), saved.label);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.toast.fromProblem(error);
      },
    });
  }

  protected askDelete(): void {
    const row = this.row();
    if (!row) return;
    this.entities.dependents(this.entityKey(), row.id).subscribe({
      next: (report) => {
        this.dependents.set(report.dependents);
        this.confirmOpen.set(true);
      },
      error: () => this.confirmOpen.set(true),
    });
  }

  protected confirmDelete(): void {
    const row = this.row();
    if (!row) return;
    this.entities.remove(this.entityKey(), row.id, this.reassignTo() ?? undefined).subscribe({
      next: () => {
        this.confirmOpen.set(false);
        this.toast.success(this.translate.instant('common.deleted'), row.label);
        void this.router.navigate([`/records/${this.entityKey()}`]);
      },
      error: () => this.confirmOpen.set(false),
    });
  }

  protected print(): void {
    window.print();
  }

  protected goBack(): void {
    void this.router.navigate([`/records/${this.entityKey()}`]);
  }
}
