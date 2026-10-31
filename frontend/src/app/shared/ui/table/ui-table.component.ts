import {
  ChangeDetectionStrategy,
  Component,
  ContentChildren,
  QueryList,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { downloadCsv } from '../../../core/util/csv';
import { formatDate, formatDateTime } from '../../../core/util/format';
import { UiChipComponent } from '../chip/ui-chip.component';
import { UiIconComponent } from '../icon/ui-icon.component';
import { UiPaginationComponent } from '../pagination/ui-pagination.component';
import { UiSkeletonComponent } from '../skeleton/ui-skeleton.component';
import { UiEmptyStateComponent } from '../empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../error-state/ui-error-state.component';
import { UiCellDirective, UiRowActionsDirective } from './ui-cell.directive';

// one import site for the whole table kit — templates use the directives and the
// row action button alongside <ui-table>, so they ship from this module
export { UiCellDirective, UiRowActionsDirective, type UiCellContext } from './ui-cell.directive';
export { UiIconButtonComponent } from './ui-icon-button.component';

export type SortOrder = 'asc' | 'desc';

export interface SortState {
  field: string;
  order: SortOrder;
}

export interface TableColumn<T = Record<string, unknown>> {
  field: string;
  header: string;
  sortable?: boolean;
  visible?: boolean;
  width?: string;
  align?: 'start' | 'center' | 'end';
  cellClass?: string;
  /** Cell rendering hint: raw text, short date, date+time, boolean tick, status chip. */
  format?: 'text' | 'date' | 'datetime' | 'bool' | 'status' | 'number';
  csv?: (row: T) => string | number;
}

type Row = Record<string, unknown>;

/**
 * The list/table used by every collection screen. It is deliberately dumb: the
 * page owns the HTTP call and passes rows + total, so server side sort, paging
 * and filtering stay in the URL and survive a refresh.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-table',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    TranslateModule,
    UiIconComponent,
    UiChipComponent,
    UiPaginationComponent,
    UiSkeletonComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-table.component.html',
  styleUrls: ['./ui-table.component.scss'],
})
export class UiTableComponent<T extends object = Row> {
  private readonly translate = inject(TranslateService);

  readonly columns = input.required<TableColumn<T>[]>();
  readonly rows = input<T[]>([]);
  readonly total = input(0);
  readonly loading = input(false, { transform: booleanAttribute });
  readonly error = input<string | null>(null);
  readonly sort = input<SortState | null>(null);
  readonly page = input(1);
  readonly pageSize = input(20);
  readonly pageSizes = input<number[]>([10, 20, 50, 100]);
  readonly selectable = input(false, { transform: booleanAttribute });
  readonly trackId = input('id');
  readonly emptyTitle = input<string | null>(null);
  readonly emptyHint = input<string | null>(null);
  readonly emptyIcon = input('inbox');
  readonly exportName = input<string | null>(null);
  readonly stickyHeader = input(true, { transform: booleanAttribute });
  readonly dense = input(false, { transform: booleanAttribute });
  readonly actionsLabel = input<string | null>(null);
  /** When set, column visibility is remembered in `localStorage`. */
  readonly columnsId = input<string | null>(null);
  readonly rowHref = input<((row: T) => string) | null>(null);

  readonly sortChange = output<SortState>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly selectionChange = output<string[]>();
  readonly rowClick = output<T>();
  readonly retry = output<void>();

  @ContentChildren(UiCellDirective) protected cellTemplates?: QueryList<UiCellDirective>;
  @ContentChildren(UiRowActionsDirective) protected actionTemplates?: QueryList<UiRowActionsDirective>;

  protected readonly hidden = signal<Set<string>>(new Set());
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly menuOpen = signal(false);

  readonly hasActions = computed(() => (this.actionTemplates?.length ?? 0) > 0);

  constructor() {
    const stored = this.columnsId() ? localStorage.getItem(`medicare.table.${this.columnsId()}.columns`) : null;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) this.hidden.set(new Set(parsed.filter((k): k is string => typeof k === 'string')));
      } catch {
        /* a corrupt entry is simply ignored */
      }
    }
    effect(() => {
      // a new page of results clears the ticks, which refer to the previous rows
      this.rows();
      if (this.selected().size > 0) this.selected.set(new Set());
      this.selectionChange.emit([]);
    });
  }

  protected get templates(): readonly UiCellDirective[] {
    return this.cellTemplates?.toArray() ?? [];
  }

  protected templateFor(field: string): UiCellDirective | undefined {
    return this.templates.find((tpl) => tpl.field === field);
  }

  protected get visibleColumns(): TableColumn<T>[] {
    return this.columns().filter((column) => !this.hidden().has(column.field) && column.visible !== false);
  }

  protected trackColumn(_index: number, column: TableColumn<T>): string {
    return column.field;
  }

  protected trackRow(_index: number, row: T): string {
    return String((row as Row)[this.trackId()] ?? '');
  }

  protected value(row: T, field: string): string {
    const raw = this.raw(row, field);
    if (raw === null || raw === undefined || raw === '') return '';
    return String(raw);
  }

  /** Resolves a cell against the shapes the API returns: fields map, row, label. */
  protected raw(row: T, field: string): unknown {
    const record = row as Row;
    const fields = record['fields'] as Row | undefined;
    if (fields && Object.prototype.hasOwnProperty.call(fields, field)) return fields[field];
    if (Object.prototype.hasOwnProperty.call(record, field)) return record[field];
    const relations = record['relations'] as Row | undefined;
    const relation = relations?.[field];
    if (Array.isArray(relation)) return relation.map((ref) => (ref as Row)['label'] ?? '').filter(Boolean).join(', ');
    if (relation && typeof relation === 'object') return (relation as Row)['label'] ?? '';
    return field === 'label' ? record['label'] : undefined;
  }

  protected display(row: T, column: TableColumn<T>): string {
    const raw = this.raw(row, column.field);
    if (raw === null || raw === undefined || raw === '') return '';
    const lang = (this.translate.currentLang ?? 'en');
    switch (column.format) {
      case 'date':
        return formatDate(String(raw), lang);
      case 'datetime':
        return formatDateTime(String(raw), lang);
      case 'bool':
        return this.translate.instant(raw ? 'uipage.yes' : 'uipage.no');
      default:
        return String(raw);
    }
  }

  protected isTrue(row: T, column: TableColumn<T>): boolean {
    const raw = this.raw(row, column.field);
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
  }

  protected statusClass(value: string): string {
    const key = value.toLowerCase();
    if (['confirmed', 'completed', 'active'].includes(key)) return 'status-confirmed';
    if (key === 'pending') return 'status-pending';
    if (key === 'scheduled') return 'status-scheduled';
    if (['cancelled', 'canceled', 'critical', 'urgent'].includes(key)) return 'status-cancelled';
    return 'status-info';
  }

  protected alignClass(column: TableColumn<T>): string {
    if (column.align === 'center') return 'is-center';
    if (column.align === 'end') return 'is-end';
    return '';
  }

  protected sortedBy(column: TableColumn<T>): SortState | null {
    const sort = this.sort();
    if (!sort || sort.field !== column.field) return null;
    return sort;
  }

  protected sortBy(column: TableColumn<T>): void {
    if (!column.sortable) return;
    const current = this.sort();
    const order: SortOrder = current?.field === column.field && current.order === 'asc' ? 'desc' : 'asc';
    this.sortChange.emit({ field: column.field, order });
  }

  protected goPage(next: number): void {
    this.pageChange.emit(next);
  }

  protected changeSize(size: number): void {
    this.pageSizeChange.emit(size);
  }

  protected toggleRow(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.selectionChange.emit([...next]);
      return next;
    });
  }

  protected clickRow(row: T): void {
    this.rowClick.emit(row);
  }

  protected get allChecked(): boolean {
    const ids = this.rows().map((row) => this.rowId(row));
    return ids.length > 0 && ids.every((id) => this.selected().has(id));
  }

  protected toggleAll(): void {
    this.selected.update(() => {
      if (this.allChecked) return new Set();
      return new Set(this.rows().map((row) => this.rowId(row)));
    });
    this.selectionChange.emit([...this.selected()]);
  }

  protected rowId(row: T): string {
    return String((row as Row)[this.trackId()] ?? '');
  }

  protected get sizeItems(): { id: string; label: string }[] {
    return this.pageSizes().map((size) => ({ id: String(size), label: String(size) }));
  }

  protected toggleColumn(field: string): void {
    this.hidden.update((set) => {
      const next = new Set(set);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      this.persist(next);
      return next;
    });
  }

  protected resetColumns(): void {
    this.hidden.set(new Set());
    this.persist(new Set());
  }

  protected openMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected exportCsv(): void {
    const name = this.exportName();
    if (!name) return;
    const columns = this.visibleColumns;
    const header = columns.map((column) => column.field);
    const body = this.rows().map((row) => {
      const record: Record<string, unknown> = {};
      for (const column of columns) {
        record[column.field] = column.csv ? column.csv(row) : this.raw(row, column.field);
      }
      return record;
    });
    downloadCsv(name, header, body);
  }

  protected retryClick(): void {
    this.retry.emit();
  }

  protected skeletonRows(count: number): number[] {
    return Array.from({ length: count }, (_unused, index) => index);
  }

  protected skeletonWidth(column: number): string {
    return `${55 + (column % 4) * 10}%`;
  }

  protected get columnCount(): number {
    return this.visibleColumns.length + (this.selectable() ? 1 : 0) + (this.hasActions() ? 1 : 0);
  }

  private persist(hidden: Set<string>): void {
    const id = this.columnsId();
    if (!id) return;
    try {
      localStorage.setItem(`medicare.table.${id}.columns`, JSON.stringify([...hidden]));
    } catch {
      /* private mode: visibility simply is not remembered */
    }
  }
}
