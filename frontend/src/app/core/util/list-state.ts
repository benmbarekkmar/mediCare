import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

export type SortOrder = 'asc' | 'desc';

export interface ListParams {
  page: number;
  pageSize: number;
  sort: string | null;
  order: SortOrder;
  q: string;
  /** Entity specific filters (`department`, `status`, `minAge`, ...) shown as chips. */
  filters: Record<string, string>;
}

/** Query keys that drive the screen itself and must never reach a list filter. */
const RESERVED = new Set(['page', 'pageSize', 'sort', 'order', 'q', 'create']);

export const DEFAULT_PARAMS: ListParams = {
  page: 1,
  pageSize: 20,
  sort: null,
  order: 'asc',
  q: '',
  filters: {},
};

/**
 * The single source of truth for a list view: what the table shows and what the
 * address bar carries are the same object, so a filtered, paged view survives a
 * refresh, a copy-pasted link and the browser back button.
 */
export class UrlListState {
  readonly params: WritableSignal<ListParams>;
  private sub: Subscription | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly path: string,
    defaults: Partial<ListParams> = {},
  ) {
    this.params = signal(readParams(this.route.snapshot.queryParams, { ...DEFAULT_PARAMS, ...defaults }));
    // keep the signal in step with navigation the user did with back/forward
    this.sub = this.route.queryParamMap.subscribe((map) => {
      const raw: Record<string, string> = {};
      map.keys.forEach((key) => (raw[key] = map.get(key) ?? ''));
      const next = readParams(raw, this.params());
      if (serialize(next) !== serialize(this.params())) this.params.set(next);
    });
  }

  destroy(): void {
    this.sub?.unsubscribe();
    this.sub = null;
  }

  /** Merges a patch and pushes it to the URL; changing the query resets to page 1. */
  patch(partial: Partial<ListParams>, options: { resetPage?: boolean } = {}): void {
    const current = this.params();
    const searchChanged = partial.q !== undefined || partial.filters !== undefined || options.resetPage === true;
    const merged: ListParams = {
      ...current,
      ...partial,
      filters: partial.filters ?? current.filters,
      page: partial.page ?? (searchChanged ? 1 : current.page),
    };
    this.params.set(merged);
    void this.router.navigate([this.path], { queryParams: this.toQuery(merged), replaceUrl: true });
  }

  setFilter(name: string, value: string | null | undefined): void {
    const filters = { ...this.params().filters };
    if (value === null || value === undefined || value === '') delete filters[name];
    else filters[name] = value;
    this.patch({ filters });
  }

  setSort(sort: string | null, order: SortOrder): void {
    this.patch({ sort, order });
  }

  clearAll(): void {
    this.params.set({ ...DEFAULT_PARAMS });
    void this.router.navigate([this.path], { queryParams: {}, replaceUrl: true });
  }

  toQuery(params = this.params()): Record<string, string> {
    const query: Record<string, string> = {};
    if (params.page !== 1) query['page'] = String(params.page);
    if (params.pageSize !== DEFAULT_PARAMS.pageSize) query['pageSize'] = String(params.pageSize);
    if (params.sort) query['sort'] = params.sort;
    if (params.order !== 'asc') query['order'] = params.order;
    if (params.q) query['q'] = params.q;
    for (const [key, value] of Object.entries(params.filters)) if (value) query[key] = value;
    return query;
  }

  /** Chips shown above the table: one per active filter, q included. */
  chips(): { key: string; value: string }[] {
    const params = this.params();
    const chips = params.q ? [{ key: 'q', value: params.q }] : [];
    return [...chips, ...Object.entries(params.filters).map(([key, value]) => ({ key, value }))];
  }
}

function readParams(raw: Record<string, string | undefined>, base: ListParams): ListParams {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED.has(key) || !value) continue;
    filters[key] = value;
  }
  return {
    page: positive(raw['page'], base.page),
    pageSize: positive(raw['pageSize'], base.pageSize),
    sort: raw['sort'] || null,
    order: raw['order'] === 'desc' ? 'desc' : 'asc',
    q: raw['q'] ?? '',
    filters,
  };
}

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const serialize = (params: ListParams): string =>
  JSON.stringify({ ...params, filters: Object.entries(params.filters).sort() });
