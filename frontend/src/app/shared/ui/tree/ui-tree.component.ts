import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { ClassNode } from '../../../core/api/models';
import { compact } from '../../../core/util/format';
import { UiIconComponent } from '../icon/ui-icon.component';

let nextTreeInstance = 0;

interface TreeRow {
  node: ClassNode;
  level: number;
  path: string;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  setSize: number;
  posInSet: number;
}

/**
 * The Ontology Explorer class tree: every class with the number of individuals
 * it owns, expandable, searchable and fully keyboard driven.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-tree',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (search()) {
      <div class="ui-tree__search ui-field">
        <label class="ui-label" [for]="inputId">{{ 'ui.tree.search' | translate }}</label>
        <input
          [id]="inputId"
          class="ui-control"
          type="search"
          autocomplete="off"
          [value]="term()"
          (input)="onTerm($event)"
        />
      </div>
    }

    <div class="ui-tree" role="tree" [attr.aria-label]="'uidata.tree.label' | translate" (keydown)="onKeydown($event)">
      @for (row of rows(); track row.path) {
        <div
          class="ui-tree__row"
          role="treeitem"
          [attr.data-node]="row.node.id"
          [attr.aria-level]="row.level + 1"
          [attr.aria-setsize]="row.setSize"
          [attr.aria-posinset]="row.posInSet"
          [attr.aria-expanded]="row.hasChildren ? row.expanded : null"
          [attr.aria-selected]="row.selected"
          [attr.tabindex]="row.node.id === activeId() ? 0 : -1"
          [class.ui-tree__row--selected]="row.selected"
          [style.padding-inline-start]="indent(row.level)"
          (click)="onRowClick($event)"
        >
          <span class="ui-tree__twisty" [attr.aria-hidden]="row.hasChildren ? null : 'true'">
            @if (row.hasChildren) {
              <ui-icon [name]="row.expanded ? 'chevron-down' : 'chevron-right'" [size]="14" />
            }
          </span>
          <span class="ui-tree__label truncate">{{ row.node.label }}</span>
          <span class="ui-tree__count" [attr.title]="'uidata.tree.count' | translate: { count: row.node.individuals }">
            {{ row.node.individuals === 0 ? '-' : count(row.node.individuals) }}
          </span>
        </div>
      } @empty {
        <p class="ui-tree__empty">
          {{ (term().length > 0 ? 'uidata.tree.noMatch' : 'ui.empty.title') | translate }}
        </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .ui-tree__search {
        margin-block-end: var(--sp-2);
      }
      .ui-tree {
        display: flex;
        flex-direction: column;
        gap: 1px;
        max-height: 100%;
        overflow-y: auto;
        scrollbar-width: thin;
      }
      .ui-tree__row {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding-block: var(--sp-1);
        padding-inline-end: var(--sp-2);
        border: 1px solid transparent;
        border-radius: var(--radius-input);
        font-size: var(--fs-sm);
        color: var(--text);
        cursor: pointer;
        min-width: 0;
        transition:
          background var(--duration-fast) var(--ease),
          border-color var(--duration-fast) var(--ease);
      }
      .ui-tree__row:hover {
        background: var(--bg-hover);
      }
      .ui-tree__row:focus-visible {
        outline: none;
        border-color: var(--primary);
        box-shadow: var(--focus-ring);
      }
      .ui-tree__row--selected {
        background: var(--primary-soft);
        border-color: var(--primary);
        color: var(--primary);
        font-weight: 600;
      }
      .ui-tree__twisty {
        display: inline-flex;
        width: var(--sp-4);
        flex: none;
        color: var(--text-muted);
      }
      .ui-tree__label {
        min-width: 0;
        flex: 1 1 auto;
      }
      .ui-tree__count {
        flex: none;
        font-size: var(--fs-xs);
        color: var(--text-subtle);
        font-variant-numeric: tabular-nums;
      }
      .ui-tree__row--selected .ui-tree__count {
        color: var(--primary);
      }
      .ui-tree__empty {
        margin: var(--sp-2) 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
    `,
  ],
})
export class UiTreeComponent {
  readonly nodes = input<ClassNode[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly search = input(true, { transform: booleanAttribute });

  readonly nodeSelect = output<string>();

  protected readonly inputId = `ui-tree-filter-${nextTreeInstance++}`;
  private readonly element = inject(ElementRef<HTMLElement>);

  protected readonly term = signal('');
  private readonly focusId = signal<string | null>(null);
  /** `null` while nobody touched a branch: the sensible default is used. */
  private readonly expandedIds = signal<ReadonlySet<string> | null>(null);

  protected readonly onTerm = (event: Event): void => {
    this.term.set((event.target as HTMLInputElement).value.trim());
  };

  protected readonly activeId = computed<string | null>(() => {
    const rows = this.rows();
    const focus = this.focusId();
    if (focus !== null && rows.some((row) => row.node.id === focus)) return focus;
    const selected = this.selectedId();
    if (selected !== null && rows.some((row) => row.node.id === selected)) return selected;
    return rows[0]?.node.id ?? null;
  });

  /** The roots and the branch that holds the selected class. */
  private readonly defaultExpanded = computed<ReadonlySet<string>>(() => {
    const open = new Set<string>();
    const selected = this.selectedId();
    for (const root of this.nodes()) {
      open.add(root.id);
      if (selected === null || selected === root.id) continue;
      const ancestors = findPath(root, selected, []);
      if (ancestors !== null) ancestors.forEach((id) => open.add(id));
      open.add(selected);
    }
    return open;
  });

  private readonly openIds = computed(() => this.expandedIds() ?? this.defaultExpanded());

  protected readonly rows = computed<TreeRow[]>(() => {
    const needle = this.term().toLowerCase();
    const nodes = this.nodes();
    if (needle.length === 0) return this.flatten(nodes, this.openIds());
    const kept = matchingIds(nodes, needle);
    return this.flatten(nodes, kept, kept);
  });

  /**
   * Flattens the visible branch. `only` restricts the walk to the kept ids and
   * forces those branches open, `open` decides the expansion otherwise.
   */
  private flatten(nodes: ClassNode[], open: ReadonlySet<string>, only?: ReadonlySet<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    const walk = (list: ClassNode[], level: number, parents: string[]): void => {
      list.forEach((node) => {
        if (only !== undefined && !only.has(node.id)) return;
        const children = only === undefined ? node.children : node.children.filter((child) => only.has(child.id));
        const hasChildren = children.length > 0;
        const expanded = only !== undefined || open.has(node.id);
        rows.push({
          node,
          level,
          path: [...parents, node.id].join('/'),
          hasChildren,
          expanded: hasChildren && expanded,
          selected: node.id === this.selectedId(),
          setSize: 0,
          posInSet: 0,
        });
        if (hasChildren && expanded) walk(children, level + 1, [...parents, node.id]);
      });
    };
    walk(nodes, 0, []);
    return withPositions(rows);
  }

  protected indent(level: number): string {
    return `calc(var(--sp-2) + ${level} * var(--sp-4))`;
  }

  /** Public so a screen can wire its own "expand all" button. */
  expandAll(): void {
    const all = new Set<string>();
    const walk = (list: ClassNode[]): void => {
      list.forEach((node) => {
        if (node.children.length > 0) all.add(node.id);
        walk(node.children);
      });
    };
    walk(this.nodes());
    this.expandedIds.set(all);
  }

  /** Thousands separator for the class counters. */
  protected readonly count = (value: number): string => compact(value);

  collapseAll(): void {
    this.expandedIds.set(new Set<string>());
  }

  protected onRowClick(event: Event): void {
    const target = event.target;
    const row = closestRow(target);
    if (row === null) return;
    const inTwisty = target instanceof Element && target.closest('.ui-tree__twisty') !== null;
    const entry = this.rows().find((candidate) => candidate.node.id === row.id);
    if (entry === undefined) return;
    if (inTwisty) {
      if (entry.hasChildren) this.expandOne(entry.node.id, !entry.expanded);
      return;
    }
    this.select(entry);
  }

  /** Selecting a class also opens its branch, never closes it. */
  private select(row: TreeRow): void {
    this.focusId.set(row.node.id);
    if (row.hasChildren && !row.expanded) this.expandOne(row.node.id, true);
    this.nodeSelect.emit(row.node.id);
  }

  private expandOne(id: string, open: boolean): void {
    const set = new Set(this.openIds());
    if (open) set.add(id);
    else set.delete(id);
    this.expandedIds.set(set);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    const hit = closestRow(event.target);
    if (hit === null) return;
    const index = rows.findIndex((row) => row.node.id === hit.id);
    const row = rows[index];
    if (row === undefined) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.preventDefault(event);
      this.move(rows, index + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home') {
      this.preventDefault(event);
      this.move(rows, 0);
      return;
    }
    if (event.key === 'End') {
      this.preventDefault(event);
      this.move(rows, rows.length - 1);
      return;
    }
    if (event.key === 'ArrowRight' && row.hasChildren && !row.expanded) {
      this.preventDefault(event);
      this.expandOne(row.node.id, true);
      return;
    }
    if (event.key === 'ArrowLeft') {
      this.preventDefault(event);
      if (row.hasChildren && row.expanded) this.expandOne(row.node.id, false);
      else this.move(rows, this.parentIndex(rows, index));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      this.preventDefault(event);
      this.select(row);
    }
  }

  private preventDefault(event: KeyboardEvent): void {
    event.preventDefault();
  }

  private parentIndex(rows: TreeRow[], index: number): number {
    const level = rows[index]?.level ?? 0;
    if (level === 0) return index;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const row = rows[cursor];
      if (row !== undefined && row.level === level - 1) return cursor;
    }
    return index;
  }

  private move(rows: TreeRow[], index: number): void {
    const clamped = Math.min(Math.max(0, index), Math.max(0, rows.length - 1));
    const id = rows[clamped]?.node.id;
    if (id === undefined) return;
    this.focusId.set(id);
    (this.element.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-node="${cssEscape(id)}"]`)?.focus();
  }
}

/** A flat list needs its own set size per level, the nested grouping is gone. */
const withPositions = (rows: TreeRow[]): TreeRow[] => {
  const perLevel = new Map<number, number>();
  for (const row of rows) perLevel.set(row.level, (perLevel.get(row.level) ?? 0) + 1);
  const seen = new Map<number, number>();
  return rows.map((row) => {
    const position = (seen.get(row.level) ?? 0) + 1;
    seen.set(row.level, position);
    return { ...row, setSize: perLevel.get(row.level) ?? position, posInSet: position };
  });
};

/** Every id that matches, with its ancestors so a match is never orphaned. */
const matchingIds = (nodes: ClassNode[], term: string): ReadonlySet<string> => {
  const kept = new Set<string>();
  const walk = (node: ClassNode, ancestors: string[]): boolean => {
    const selfMatch = `${node.label} ${node.id}`.toLowerCase().includes(term);
    let branchMatch = selfMatch;
    for (const child of node.children) {
      if (walk(child, [...ancestors, node.id])) branchMatch = true;
    }
    if (branchMatch) {
      kept.add(node.id);
      if (selfMatch) ancestors.forEach((id) => kept.add(id));
    }
    return branchMatch;
  };
  nodes.forEach((node) => walk(node, []));
  return kept;
};

/** The ancestors of `id`, the branch that has to be open to reach it. */
const findPath = (node: ClassNode, id: string, trail: string[]): string[] | null => {
  if (node.id === id) return trail;
  const path = [...trail, node.id];
  for (const child of node.children) {
    const found = findPath(child, id, path);
    if (found !== null) return found;
  }
  return null;
};

const closestRow = (target: EventTarget | null): { id: string } | null => {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>('[data-node]');
  const id = row?.getAttribute('data-node');
  return id === null || id === undefined ? null : { id };
};

const cssEscape = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
