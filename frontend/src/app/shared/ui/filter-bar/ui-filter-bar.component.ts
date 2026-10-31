import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { Observable, Subscription } from 'rxjs';
import type { EntityKey, Ref } from '../../../core/api/models';
import { DEFAULT_PARAMS, type ListParams } from '../../../core/util/list-state';
import { UiChipComponent } from '../chip/ui-chip.component';
import { UiIconComponent } from '../icon/ui-icon.component';

/**
 * The `SelectOption` shape of `ui-select`, structurally identical so a page can
 * pass either type. Declared locally keeps the filter bar free of the select
 * component as a compile time dependency.
 */
export type SelectOption = { value: string | number; label: string; disabled?: boolean };

export type FilterSpec =
  | { kind: 'search'; label: string; placeholder: string }
  | { kind: 'select'; field: string; label: string; options: SelectOption[] }
  | { kind: 'multi'; field: string; label: string; options: SelectOption[] }
  | {
      kind: 'entity';
      field: string;
      label: string;
      entity: EntityKey;
      optionLoader: (key: EntityKey) => Observable<Ref[]>;
    }
  | { kind: 'range'; fields: [string, string]; label: string; unit?: string; min?: number; max?: number }
  | { kind: 'dateRange'; fields: [string, string]; label: string }
  | { kind: 'toggle'; field: string; label: string };

export type FilterPatch = Partial<ListParams>;

type SingleSpec = Extract<FilterSpec, { field: string }>;
type PairSpec = Extract<FilterSpec, { fields: [string, string] }>;

interface ActiveChip {
  key: string;
  label: string;
  value: string;
  patch: FilterPatch;
}

const SEARCH_KEY = 'q';

const isEntitySpec = (spec: FilterSpec): spec is Extract<FilterSpec, { kind: 'entity' }> => spec.kind === 'entity';
const isSingleSpec = (spec: FilterSpec): spec is SingleSpec => 'field' in spec;
const isPairSpec = (spec: FilterSpec): spec is PairSpec => 'fields' in spec;
const labelOf = (options: SelectOption[], value: string): string =>
  options.find((option) => String(option.value) === value)?.label ?? value;

const without = (filters: Record<string, string>, field: string): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) if (key !== field && value) next[key] = value;
  return next;
};

let nextFilterBarId = 0;

/**
 * The filter row of every list screen, a pure view over `ListParams`: the specs
 * describe the controls, `values` carries the current state (URL synced by
 * `UrlListState`) and every interaction emits a `Partial<ListParams>` patch, so
 * the chips, the address bar and the request stay one and the same object.
 *
 * The search control debounces 300 ms, so typing never navigates.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-filter-bar',
  standalone: true,
  imports: [TranslateModule, UiChipComponent, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fb">
      <h2 class="visually-hidden">{{ 'ui.filters.label' | translate }}</h2>

      <div class="fb__grid">
        @for (spec of filters(); track $index) {
          <div class="fb__cell">
            <label class="ui-label" [id]="labelId($index)" [attr.for]="primaryId($index, spec)">{{ spec.label }}</label>

            @switch (spec.kind) {
              @case ('search') {
                <div class="fb__search">
                  <span class="fb__search-icon" aria-hidden="true">
                    <ui-icon name="search" size="16"></ui-icon>
                  </span>
                  <input
                    #searchField
                    class="ui-control fb__input"
                    type="search"
                    [id]="controlId($index)"
                    [value]="term()"
                    [attr.placeholder]="placeholderOf(spec)"
                    (input)="onSearch(searchField.value)"
                    (keydown.enter)="onSearchNow(searchField.value)"
                  />
                </div>
              }
              @case ('select') {
                <select #selectField class="ui-control" [id]="controlId($index)" (change)="onSelectChange(spec, selectField.value)">
                  <option value="" [selected]="isEmpty(spec)">{{ 'ui.filters.any' | translate }}</option>
                  @for (option of optionsOf(spec); track option.value) {
                    <option [value]="text(option.value)" [selected]="isSelected(spec, option.value)" [attr.disabled]="isDisabled(option)">
                      {{ option.label }}
                    </option>
                  }
                </select>
              }
              @case ('entity') {
                <select
                  #entityField
                  class="ui-control"
                  [id]="controlId($index)"
                  [attr.aria-busy]="loadingEntity(spec) ? 'true' : 'false'"
                  (change)="onSelectChange(spec, entityField.value)"
                >
                  <option value="" [selected]="isEmpty(spec)">{{ 'ui.filters.any' | translate }}</option>
                  @for (option of optionsOf(spec); track option.value) {
                    <option [value]="text(option.value)" [selected]="isSelected(spec, option.value)">{{ option.label }}</option>
                  }
                </select>
                @if (loadingEntity(spec)) {
                  <span class="fb__busy">{{ 'common.loading' | translate }}</span>
                }
              }
              @case ('multi') {
                <div class="fb__set" role="group" [attr.aria-labelledby]="labelId($index)">
                  @for (option of optionsOf(spec); track option.value) {
                    <button
                      type="button"
                      class="fb__set-item"
                      [class.is-on]="inList(spec, option.value)"
                      [attr.aria-pressed]="inList(spec, option.value) ? 'true' : 'false'"
                      (click)="toggleMulti(spec, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  }
                </div>
              }
              @case ('range') {
                <div class="fb__pair">
                  <span class="fb__pair-word">{{ 'ui.filters.from' | translate }}</span>
                  <input
                    #rangeFrom
                    class="ui-control"
                    type="number"
                    [id]="controlId($index)"
                    [attr.aria-label]="boundLabel(spec, 0)"
                    [attr.min]="minOf(spec)"
                    [attr.max]="maxOf(spec)"
                    [value]="valueOf(fieldAt(spec, 0))"
                    (change)="onRange(spec, 0, rangeFrom.value)"
                  />
                  <span class="fb__pair-word">{{ 'ui.filters.to' | translate }}</span>
                  <input
                    #rangeTo
                    class="ui-control"
                    type="number"
                    [attr.aria-label]="boundLabel(spec, 1)"
                    [attr.min]="minOf(spec)"
                    [attr.max]="maxOf(spec)"
                    [value]="valueOf(fieldAt(spec, 1))"
                    (change)="onRange(spec, 1, rangeTo.value)"
                  />
                  @if (unitOf(spec)) {
                    <span class="fb__unit">{{ unitOf(spec) }}</span>
                  }
                </div>
              }
              @case ('dateRange') {
                <div class="fb__pair">
                  <span class="fb__pair-word">{{ 'ui.filters.from' | translate }}</span>
                  <input
                    #dateFrom
                    class="ui-control"
                    type="date"
                    [id]="controlId($index)"
                    [attr.aria-label]="boundLabel(spec, 0)"
                    [value]="valueOf(fieldAt(spec, 0))"
                    (change)="onRange(spec, 0, dateFrom.value)"
                  />
                  <span class="fb__pair-word">{{ 'ui.filters.to' | translate }}</span>
                  <input
                    #dateTo
                    class="ui-control"
                    type="date"
                    [attr.aria-label]="boundLabel(spec, 1)"
                    [value]="valueOf(fieldAt(spec, 1))"
                    (change)="onRange(spec, 1, dateTo.value)"
                  />
                </div>
              }
              @case ('toggle') {
                <div class="fb__switch">
                  <input
                    #checkField
                    class="fb__check"
                    type="checkbox"
                    [id]="controlId($index)"
                    [checked]="valueOf(fieldOf(spec)) === 'true'"
                    (change)="onToggle(spec, checkField.checked)"
                  />
                  <span class="fb__switch-text">{{ 'common.yes' | translate }}</span>
                </div>
              }
            }
          </div>
        }
      </div>

      @if (chips().length > 0) {
        <div class="fb__active">
          <span class="fb__active-label" [id]="activeId">{{ 'ui.filters.active' | translate }}</span>
          <ul class="fb__chips" [attr.aria-labelledby]="activeId">
            @for (chip of chips(); track chip.key) {
              <li class="fb__chip">
                <ui-chip
                  [label]="('uipage.filters.chip' | translate: { label: chip.label, value: chip.value })"
                  [removable]="true"
                  (removed)="remove(chip)"
                ></ui-chip>
              </li>
            }
          </ul>
          <button type="button" class="fb__clear" (click)="clearAll()">{{ 'ui.filters.clearAll' | translate }}</button>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .fb {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        padding: var(--sp-4);
      }
      .fb h2 {
        margin: 0;
      }
      .fb__grid {
        display: grid;
        gap: var(--sp-3) var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      }
      .fb__cell {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        min-width: 0;
      }
      .fb__search {
        position: relative;
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .fb__search-icon {
        position: absolute;
        inset-inline-start: var(--sp-3);
        display: inline-flex;
        color: var(--text-subtle);
        pointer-events: none;
      }
      .fb__input {
        padding-inline-start: 34px;
      }
      .fb__input::-webkit-search-cancel-button,
      .fb__input::-webkit-search-decoration {
        display: none;
        appearance: none;
      }
      .fb__busy {
        font-size: var(--fs-xs);
        color: var(--text-subtle);
      }
      .fb__pair {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
        min-width: 0;
      }
      .fb__pair .ui-control {
        flex: 1 1 88px;
        min-width: 0;
      }
      .fb__pair-word,
      .fb__unit {
        font-size: var(--fs-xs);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .fb__set {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-1);
        min-width: 0;
      }
      .fb__set-item {
        font: inherit;
        font-size: var(--fs-xs);
        color: var(--text-muted);
        background: var(--bg-sunken);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-pill);
        padding: var(--sp-1) var(--sp-3);
        cursor: pointer;
        transition:
          color var(--duration) var(--ease),
          background var(--duration) var(--ease),
          border-color var(--duration) var(--ease);
      }
      .fb__set-item:hover {
        color: var(--primary);
        border-color: var(--primary);
      }
      .fb__set-item.is-on {
        color: var(--text-inverse);
        background: var(--primary);
        border-color: var(--primary);
      }
      .fb__switch {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
      }
      .fb__check {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--primary);
        cursor: pointer;
      }
      .fb__switch-text {
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .fb__active {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
        margin-block-start: var(--sp-4);
        padding-block-start: var(--sp-3);
        border-block-start: 1px solid var(--border);
      }
      .fb__active-label {
        font-size: var(--fs-xs);
        font-weight: 600;
        color: var(--text-muted);
        white-space: nowrap;
      }
      .fb__chips {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
        margin: 0;
        padding: 0;
        list-style: none;
        min-width: 0;
      }
      .fb__chip {
        min-width: 0;
      }
      .fb__clear {
        font: inherit;
        font-size: var(--fs-sm);
        color: var(--primary);
        background: transparent;
        border: 0;
        border-radius: var(--radius-input);
        padding: var(--sp-1) var(--sp-2);
        cursor: pointer;
        transition:
          color var(--duration) var(--ease),
          background var(--duration) var(--ease);
      }
      .fb__clear:hover {
        color: var(--primary-hover);
        background: var(--primary-soft);
      }
      @media (max-width: 1024px) {
        .fb__grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .fb {
          padding: var(--sp-3);
        }
        .fb__grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class UiFilterBarComponent {
  readonly filters = input.required<FilterSpec[]>();
  readonly values = input<ListParams>(DEFAULT_PARAMS);
  readonly change = output<FilterPatch>();
  readonly clear = output<void>();

  /** the search control waits 300 ms; the other controls patch on their change event */
  protected readonly searchDebounceMs = 300;

  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeId = `ui-filter-bar-${nextFilterBarId++}-active`;
  /** what the user typed, while the patch has not come back from the page yet */
  protected readonly term = signal(this.values().q);

  private readonly entityCache = signal<ReadonlyMap<string, SelectOption[]>>(new Map());
  private readonly entityPending = signal<ReadonlySet<string>>(new Set());
  private readonly subscriptions: Subscription[] = [];
  private readonly requested = new Set<string>();
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private pushedQ = this.values().q;

  constructor() {
    // adopt a q the page changed from the outside (back/forward, clear all)
    effect(
      () => {
        const incoming = this.values().q;
        if (incoming === this.pushedQ) return;
        this.pushedQ = incoming;
        this.clearSearchTimer();
        this.term.set(incoming);
      },
      { allowSignalWrites: true },
    );

    // entity specs fetch their option list through the injected loader function,
    // so the bar itself never touches a service
    effect(
      () => {
        for (const spec of this.filters()) {
          if (!isEntitySpec(spec) || this.requested.has(spec.field)) continue;
          this.requested.add(spec.field);
          this.setPending(spec.field, true);
          const sub = spec.optionLoader(spec.entity).subscribe({
            next: (refs: Ref[]) => {
              this.setOptions(spec.field, refs.map((ref) => ({ value: ref.id, label: ref.label })));
              this.setPending(spec.field, false);
            },
            error: () => {
              this.setOptions(spec.field, []);
              this.setPending(spec.field, false);
            },
          });
          this.subscriptions.push(sub);
        }
      },
      { allowSignalWrites: true },
    );

    this.destroyRef.onDestroy(() => {
      this.clearSearchTimer();
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions.length = 0;
    });
  }

  // ------------------------------------------------------------- ids, labels

  protected controlId(index: number): string {
    return `${this.activeId}-${index}`;
  }

  protected labelId(index: number): string {
    return `${this.activeId}-label-${index}`;
  }

  /** a `<label for>` only points at a real form control, the chip group has its own name */
  protected primaryId(index: number, spec: FilterSpec): string | null {
    return spec.kind === 'multi' ? null : this.controlId(index);
  }

  protected boundLabel(spec: FilterSpec, index: number): string {
    return this.chipBoundLabel(spec, index);
  }

  // ----------------------------------------------------------------- reading

  protected valueOf(field: string): string {
    return field ? (this.values().filters[field] ?? '') : '';
  }

  protected fieldOf(spec: FilterSpec): string {
    return isSingleSpec(spec) ? spec.field : '';
  }

  protected fieldAt(spec: FilterSpec, index: number): string {
    return isPairSpec(spec) ? spec.fields[index] : '';
  }

  protected minOf(spec: FilterSpec): string | null {
    return spec.kind === 'range' && spec.min !== undefined ? String(spec.min) : null;
  }

  protected maxOf(spec: FilterSpec): string | null {
    return spec.kind === 'range' && spec.max !== undefined ? String(spec.max) : null;
  }

  protected unitOf(spec: FilterSpec): string {
    return spec.kind === 'range' ? (spec.unit ?? '') : '';
  }

  protected placeholderOf(spec: FilterSpec): string {
    return spec.kind === 'search' ? spec.placeholder : '';
  }

  protected isDisabled(option: SelectOption): string | null {
    return option.disabled === true ? '' : null;
  }

  /** a DOM `value` property is always a string, an option value is not */
  protected text(value: string | number): string {
    return String(value);
  }

  protected optionsOf(spec: FilterSpec): SelectOption[] {
    const options = isEntitySpec(spec)
      ? (this.entityCache().get(spec.field) ?? [])
      : spec.kind === 'select' || spec.kind === 'multi'
        ? spec.options
        : [];
    const current = isSingleSpec(spec) ? this.valueOf(spec.field) : '';
    // a value restored from the URL may not be part of the loaded list yet
    if (current && !options.some((option) => String(option.value) === current)) {
      return [...options, { value: current, label: current }];
    }
    return options;
  }

  protected isEmpty(spec: FilterSpec): boolean {
    return isSingleSpec(spec) ? this.valueOf(spec.field) === '' : true;
  }

  protected isSelected(spec: FilterSpec, option: string | number): boolean {
    return isSingleSpec(spec) ? this.valueOf(spec.field) === String(option) : false;
  }

  protected inList(spec: FilterSpec, option: string | number): boolean {
    return isSingleSpec(spec) ? this.listOf(spec.field).includes(String(option)) : false;
  }

  protected loadingEntity(spec: FilterSpec): boolean {
    return isSingleSpec(spec) ? this.entityPending().has(spec.field) : false;
  }

  // ------------------------------------------------------------- interaction

  protected onSearch(next: string): void {
    this.term.set(next);
    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => this.pushSearch(next), this.searchDebounceMs);
  }

  protected onSearchNow(next: string): void {
    this.clearSearchTimer();
    this.pushSearch(next);
  }

  protected onSelectChange(spec: FilterSpec, raw: string): void {
    if (!isSingleSpec(spec)) return;
    this.setFilters({ [spec.field]: raw });
  }

  protected onRange(spec: FilterSpec, index: number, raw: string): void {
    if (!isPairSpec(spec)) return;
    this.setFilters({ [spec.fields[index]]: raw });
  }

  protected onToggle(spec: FilterSpec, checked: boolean): void {
    if (!isSingleSpec(spec)) return;
    this.setFilters({ [spec.field]: checked ? 'true' : '' });
  }

  protected toggleMulti(spec: FilterSpec, option: string | number): void {
    if (!isSingleSpec(spec)) return;
    const wanted = String(option);
    const list = this.listOf(spec.field);
    const next = list.includes(wanted) ? list.filter((item) => item !== wanted) : [...list, wanted];
    this.setFilters({ [spec.field]: next.join(',') });
  }

  protected remove(chip: ActiveChip): void {
    if (chip.key === SEARCH_KEY) this.pushSearch('');
    else this.change.emit(chip.patch);
  }

  protected clearAll(): void {
    this.clearSearchTimer();
    this.pushedQ = '';
    this.term.set('');
    this.clear.emit();
  }

  // ---------------------------------------------------------------- internals

  /** Active filters as removable chips: one per filled field plus the search term. */
  protected readonly chips = computed<ActiveChip[]>(() => {
    const values = this.values();
    const chips: ActiveChip[] = [];
    if (values.q) {
      const search = this.filters().find((spec) => spec.kind === 'search');
      chips.push({
        key: SEARCH_KEY,
        label: search ? search.label : this.translate.instant('ui.search.label'),
        value: values.q,
        patch: { q: '' },
      });
    }
    for (const [field, value] of Object.entries(values.filters)) {
      if (!value) continue;
      const spec = this.specOf(field);
      chips.push({
        key: field,
        label: spec ? this.chipLabel(field, spec) : field,
        value: this.chipValue(field, value, spec),
        patch: { filters: without(values.filters, field) },
      });
    }
    return chips;
  });

  private pushSearch(next: string): void {
    this.pushedQ = next;
    if (next === this.values().q) return;
    this.change.emit({ q: next });
  }

  /** Empty values drop their key, so the chip row, the URL and the request shrink together. */
  private setFilters(patch: Record<string, string>): void {
    const filters: Record<string, string> = { ...this.values().filters };
    for (const [key, value] of Object.entries(patch)) {
      if (value) filters[key] = value;
      else delete filters[key];
    }
    this.change.emit({ filters });
  }

  private listOf(field: string): string[] {
    return this.valueOf(field)
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  private setOptions(field: string, options: SelectOption[]): void {
    const next = new Map(this.entityCache());
    next.set(field, options);
    this.entityCache.set(next);
  }

  private setPending(field: string, pending: boolean): void {
    const next = new Set(this.entityPending());
    if (pending) next.add(field);
    else next.delete(field);
    this.entityPending.set(next);
  }

  private clearSearchTimer(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private specOf(field: string): FilterSpec | undefined {
    return this.filters().find(
      (spec) => (isSingleSpec(spec) && spec.field === field) || (isPairSpec(spec) && spec.fields.includes(field)),
    );
  }

  private chipLabel(field: string, spec: FilterSpec): string {
    if (isPairSpec(spec)) return this.chipBoundLabel(spec, spec.fields.indexOf(field) === 1 ? 1 : 0);
    return spec.label;
  }

  private chipBoundLabel(spec: FilterSpec, index: number): string {
    const bound = this.translate.instant(index === 0 ? 'ui.filters.from' : 'ui.filters.to');
    return this.translate.instant('uipage.filters.bound', { label: spec.label, bound });
  }

  private chipValue(field: string, raw: string, spec: FilterSpec | undefined): string {
    if (!spec) return raw;
    if (spec.kind === 'toggle') {
      return raw === 'true' ? this.translate.instant('common.yes') : this.translate.instant('common.no');
    }
    if (spec.kind === 'multi') {
      return raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => labelOf(spec.options, part))
        .join(', ');
    }
    if (spec.kind === 'select') return labelOf(spec.options, raw);
    if (isEntitySpec(spec)) return labelOf(this.entityCache().get(spec.field) ?? [], raw);
    return raw;
  }
}
