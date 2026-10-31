# `shared/ui` component contract

This file is the **source of truth** for the design-system layer. Every screen of
the product is built from these components, and every component is built to this
signature. Do not rename a selector, an input or an output: other agents build
against it.

## Ground rules (apply to every file in `shared/ui`)

- Angular 18 **standalone** components, `changeDetection: ChangeDetectionStrategy.OnPush`.
- Signal inputs: `readonly size = input<'sm' | 'md'>('md')`, required ones use
  `input.required<T>()`. Outputs use `output<T>()` (never `@Output` + EventEmitter).
  Two-way bindings use `model<T>()`.
- **One file per component**: `shared/ui/<kebab>/<name>.component.ts` with an
  **inline** `template:` and `styles: [\`...\`]`. No separate `.html`/`.scss` files.
- Style with the CSS custom properties declared in `src/styles/_tokens.scss`
  (`--surface`, `--border`, `--text`, `--text-muted`, `--text-subtle`, `--primary`,
  `--primary-hover`, `--primary-soft`, `--danger-500`, `--success-500`,
  `--warning-500`, `--info-500`, `--radius-card`, `--radius-input`, `--radius-pill`,
  `--sp-1` … `--sp-8`, `--fs-xs` … `--fs-3xl`, `--shadow-sm|md|lg`, `--duration`,
  `--ease`, `--z-modal`, `--z-toast`, `--z-popover`, `--focus-ring`, `--scrim`,
  `--gradient-kpi`, `--chart-grid`). **Never hard-code a colour, a radius or a
  spacing value.** Light and dark themes must both work from these variables alone.
- Shared form-control skin already exists globally in `src/styles/_forms.scss`:
  reuse the classes `ui-field`, `ui-label`, `ui-label--required`, `ui-hint`,
  `ui-error`, `ui-control`, `ui-control-group`, `ui-control-addon` as-is.
- Icons: `<ui-icon name="search" size="16" />`. `name` is typed by `IconName`;
  the full list lives in `shared/ui/icon/icons.ts` (add one there if a glyph is
  genuinely missing — it is the only shared file you may touch, and only append).
- Accessibility: real `<button>`/`<input>` elements, `aria-*` where the state is
  visual only, a visible `:focus-visible` ring using `var(--focus-ring)`, full
  keyboard operation, and transitions wrapped so that `prefers-reduced-motion`
  is honoured (the global override already exists — do not add infinite
  animations or decorative motion).
- All user-visible strings go through `@ngx-translate/core`:
  `{{ 'ui.table.empty' | translate }}` or `translate` pipe/`TranslateModule`.
  Keys are namespaced by area (`common.*`, `nav.*`, `ui.*`, `errors.*`, plus the
  feature namespace you are given).
- **i18n ownership**: shared catalogues (`common`, `nav`, `ui`, `errors`) are
  already written under `public/i18n/fragments/<lang>/` and are **read-only** for
  you — if a string you need is missing, invent it under your **own** namespace.
  You own exactly one fragment pair: `public/i18n/fragments/en/<yourname>.json`
  and `public/i18n/fragments/fr/<yourname>.json`, same keys, both languages,
  French written in real French. Never touch another agent's fragment; the merge
  script fails the build on any key present in only one language.
- For component strings that belong to the design system, you may use keys under
  `ui.*` **only if they already exist**; otherwise put them in your own namespace.
- No `any`, no default exports, no console logs, no mock data, no TODO comments.
- Unit tests: for every non-trivial component add
  `shared/ui/<kebab>/<name>.component.spec.ts` (Jasmine + `TestBed`, `beforeEach`
  `configureTestSuite`-free, using `provideTranslateService()` stub via
  `NoopTranslateLoader`-style inline loader — see "Testing" below).

## Testing

`shared/ui/translate-testing.ts` exports `TRANSLATE_TEST_IMPORTS`. Every spec
uses `TestBed.configureTestingModule({ imports: [...TRANSLATE_TEST_IMPORTS, MyComponent] })`
so the `| translate` pipe resolves to the key itself.

---

## 1. Form controls

### `ui-button`

```html
<ui-button variant="primary" size="md" icon="plus" [loading]="saving()" (click)="save()">
  {{ 'patients.actions.create' | translate }}
</ui-button>
```

| input | type | default |
| --- | --- | --- |
| `variant` | `'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger'` | `'primary'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `icon` | `IconName \| null` | `null` |
| `iconRight` | `IconName \| null` | `null` |
| `loading` | `boolean` | `false` |
| `disabled` | `boolean` | `false` |
| `type` | `'button' \| 'submit'` | `'button'` |
| `fullWidth` | `boolean` | `false` |
| `href` | `string \| null` (renders an `<a>` styled as a button, for router-free links) | `null` |

Slot: projected label text. Optional `ngProjectAs="icon"` not needed — icons come
from the `icon`/`iconRight` inputs. `loading` swaps the leading icon for a
spinner and sets `[disabled]`. Host keeps `role="button"` only when it is an `<a>`.

### `ui-input` — text / number / email / tel / password, ControlValueAccessor

```html
<ui-input label="Email" formControlName="email" type="email" autocomplete="email"
          hint="Used to sign in" icon="mail" [required]="true" />
```

inputs: `label: string`, `hint: string | null`, `type: 'text'|'email'|'password'|'number'|'tel'|'search'|'url'`,
`placeholder`, `icon: IconName | null`, `suffix: string | null` (unit addon),
`required: boolean`, `disabled: boolean`, `rows?` unused, `size: 'sm'|'md'|'lg'`,
`autofocus: boolean`, `step: string | null`, `min/max: number | null`.
For `type="password"` it renders the reveal toggle itself.
Error text: reads its own `NgControl` (`ngControl.errors` + `touched`) and prints
`ui-error`; pages may pass `errors: string[]` to override.
`model`-style value binding is provided by CVA (`value` input is **not** used).

### `ui-textarea`

Same surface as `ui-input` minus icon/suffix, plus `rows: number` (4),
`maxCharacters: number | null` (shows a counter).

### `ui-select`

```html
<ui-select label="Department" formControlName="department" [options]="departmentOptions()"
           placeholder="Choose a department" [required]="true" />
```

`options: SelectOption[]` where `type SelectOption = { value: string | number; label: string; disabled?: boolean }`
(exported from `ui-select.component.ts`). `trackByValue: boolean` not needed.
Native `<select>` for reliability, styled by `select.ui-control`.

### `ui-checkbox`, `ui-switch`, `ui-radio-group`

- `ui-checkbox`: `label`, `hint`, `indeterminate?` no. CVA over `boolean`.
- `ui-switch`: same as checkbox, sliding track, `onLabel/offLabel: string | null`.
- `ui-radio-group`: `label`, `name`, `options: SelectOption[]`, `layout: 'row'|'column'`. CVA over the value.

### `ui-combobox` — async autocomplete (the pickers for patients, doctors, diseases…)

```html
<ui-combobox label="Patient" [search]="searchPatients()" [initial]="preselected()"
             [multiple]="true" placeholder="Type a patient name" formControlName="patient" />
```

| input | type | notes |
| --- | --- | --- |
| `label`, `hint`, `placeholder`, `required`, `disabled` | as `ui-input` | |
| `search` | `(term: string) => Observable<Ref[]>` | debounced **300 ms**, min 0 chars, last response wins |
| `initial` | `Ref[] \| Ref \| null` | already chosen individuals, so the field is not empty on edit |
| `multiple` | `boolean` | `false` = single select, closes on pick |
| `maxChips` | `number` (5) | extra selections collapse into `+n` |
| `emptyMessage` | `string \| null` | |

`type Ref = { id: string; iri: string; label: string; type: string }` from
`core/api/models`. CVA value is `string[]` of ids (or `string` when `multiple` is
false). Keyboard: ArrowDown/Up move, Enter picks, Escape closes, Backspace removes
the last chip. Uses CDK `A11yModule` traps or an equivalent hand-rolled focus
loop; the listbox is `role="listbox"` with `aria-activedescendant`.

### `ui-date-input` / `ui-datetime-input`

Thin, validated wrappers over `<input type="date">` / `<input type="datetime-local">`
with the `ui-field` grammar. `min`, `max`, `disabled`, `required`, `label`, `hint`.
CVA value is the raw `yyyy-mm-dd` / `yyyy-mm-ddThh:mm` string (the API speaks
XSD). Helpers exist in `core/util/format.ts` (`toDateTimeInput`, `toDateInput`).

---

## 2. Data display

### `ui-card`

```html
<ui-card title="Recent tests" subtitle="Last 10 entries" icon="flask">
  …body…
  <ng-template #actions><ui-button variant="ghost" size="sm">…</ui-button></ng-template>
  <footer uiCardFooter>…</footer>
</ui-card>
```

inputs: `title: string | null`, `subtitle: string | null`, `icon: IconName | null`,
`elevated: boolean` (shadow), `pad: 'none'|'md'|'lg'`, `clickable: boolean`
(renders as a button-like surface, `href`/routerLink left to the caller).
Content children: default slot = body; `#actions` template = header right side;
`[uiCardFooter]` directive = footer area.

### `ui-stat-card`

`value: string | number`, `label: string`, `icon: IconName`, `trend: number | null`
(percentage points, arrow + semantic colour), `hint: string | null`,
`loading: boolean`, `gradient: boolean` (KPI gradient background, white text).

### `ui-badge` / `ui-chip`

- `ui-badge`: `kind: 'status' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'`,
  `label: string` (or projected), `dot: boolean`. For appointment/test statuses use
  `kind="status"` + `[status]="row.status"` — the component maps
  Confirmed/Completed/Pending/Cancelled/Critical through `statusClass()` from
  `core/util/format.ts` and the global `.status-*` vocabulary.
- `ui-chip`: removable pill. `label`, `icon`, `removable: boolean`,
  `output` `removed: void`. Used by `ui-filter-bar` and the assistant entity list.

### `ui-avatar`

`name: string` (initials via `initials()`), `size: 'sm'|'md'|'lg'`, `role: Role | null`
(colour by role), `src: string | null`.

### `ui-skeleton`

`width: string | number`, `height: string | number`, `radius: string | null`,
`lines: number | null` (multi-line text block), `circle: boolean`.

### `ui-timeline`

`items: TimelineItem[]` with
`type TimelineItem = { id?: string; title: string; date: string; kind?: 'appointment'|'test'|'diagnosis'|'treatment'|'note'; detail?: string | null; link?: string | null }`.
Vertical rail, status colour per `kind`, newest first, links use `routerLink`.

### `ui-table` — the DataTable, the single most used component

```html
<ui-table [columns]="columns()" [rows]="page()?.items ?? []" [total]="page()?.total ?? 0"
          [loading]="loading()" [sort]="sort()" [page]="pageNo()" [pageSize]="size()"
          [selectable]="true" [trackId]="'id'" exportName="patients"
          (sortChange)="onSort($event)" (pageChange)="onPage($event)"
          (selectionChange)="onSelect($event)" (rowClick)="open($event)">
  <ng-template uiCell let-row="row" let-column="column" #name>
    <a [routerLink]="[row.id]">{{ row.name }}</a>
  </ng-template>
  <ng-template uiRowActions let-row="row">
    <ui-icon-button icon="pencil" (click)="edit(row)"></ui-icon-button>
  </ng-template>
</ui-table>
```

```ts
export interface TableColumn<T = Record<string, unknown>> {
  field: string;          // key into row.fields / row
  header: string;         // translated label
  sortable?: boolean;
  visible?: boolean;      // column visibility menu, default true
  width?: string;         // fixed px/rem, never %
  align?: 'start' | 'center' | 'end';
  cellClass?: string;     // e.g. 'truncate', 'status-text'
  csv?: (row: T) => string | number;  // CSV export projection
}
```

Rows are `Individual[]` (`core/api/models`): the component reads
`row.fields[field] ?? row[field] ?? label` and formats dates/booleans with
`core/util/format.ts`.
inputs: `columns`, `rows`, `total`, `loading` (skeleton rows), `sort:
{ field: string; order: 'asc' | 'desc' } | null`, `page`, `pageSize`,
`pageSizes: number[]` ([10, 20, 50, 100]), `selectable`, `trackId`, `emptyTitle`,
`emptyHint`, `exportName: string | null` (shows the CSV export button, uses
`core/util/csv.ts`), `stickyHeader` (true), `dense` (false), `actionsLabel`.
outputs: `sortChange`, `pageChange`, `selectionChange: string[]`, `rowClick`.
Column visibility: a `ui-dropdown` of checkboxes persisted per table id in
`localStorage` (`medicare.table.<id>.columns`) when `columnsId` is provided.
Templates: `@ContentChildren(UiCellDirective)` — the cell template is registered
with `uiCell` **and** a `name` input equal to the column field:
`<ng-template uiCell="name" let-row="row">`; `uiRowActions` for the trailing
actions column. On screens below `--breakpoint-lg` the table reflows into stacked
cards (no horizontal scrolling, ever).
Also export the small `ui-icon-button` component (`icon`, `label` for a11y,
`danger`, `disabled`, `click`) here — tables, toolbars and rows all need it.

### `ui-pagination`

`page`, `pageSize`, `total`, `siblingCount` (1). Emits `pageChange`. First/prev/
next/last + numbered windows, `aria-label` per button, disabled at the bounds.

### `ui-tabs`

```html
<ui-tabs [tabs]="tabs()" [(active)]="activeTab()">
  <ng-template #panel="uiTabs" let-tab> … renders the active panel … </ng-template>
</ui-tabs>
```

Simpler contract (use this): `tabs: { id: string; label: string; icon?: IconName | null; badge?: number | null }[]`,
two-way `active: string` (`model<string>()`), output `activeChange`. Panels are
projected by the caller with `@if (active() === 'overview')`. Roving tabindex,
Arrow Left/Right, `role="tablist"`, underline indicator animated with `--duration`.

### `ui-code-block`

`code: string`, `language: 'sparql' | 'json' | 'ttl' | 'text'`, `copyable: boolean`
(default true, copies via `navigator.clipboard`, toast on success), `label: string | null`,
`maxHeight: string` ('320px'), `wrap: boolean`. A minimal, dependency-free
tokenizer highlights SPARQL keywords / IRIs / literals / variables and JSON keys.

### `ui-tree`

`nodes: ClassNode[]` (from `core/api/models`), `selectedId: string | null`,
`search: boolean`, emits `nodeSelect: string`, expands with `expandAll`/`collapseAll`
public methods, keyboard navigable, `role="tree"`. Used by the Ontology Explorer.

---

## 3. Overlays and feedback

### `ui-modal`

```html
<ui-modal [open]="dialogOpen()" title="Add a diagnosis" size="md"
          [busy]="saving()" (openChange)="dialogOpen.set($event)">
  …body…
  <ng-template #footer>
    <ui-button variant="ghost" (click)="close()">Cancel</ui-button>
    <ui-button (click)="submit()" [loading]="saving()">Save</ui-button>
  </ng-template>
</ui-modal>
```

`open: boolean` two-way (`model`), `title: string`, `subtitle: string | null`,
`size: 'sm'|'md'|'lg'|'xl'`, `busy: boolean` (blocks Esc/backdrop),
`dismissible: boolean` (true). Focus trap: `[uiFocusTrap]` directive exists at
`shared/ui/focus-trap.directive.ts` — use it. Restores focus to the trigger,
locks body scroll, `role="dialog" aria-modal="true"`, backdrop uses `--scrim`.

### `ui-drawer`

Same API as modal plus `side: 'start'|'end'` and `width: string` ('420px'). Used
for the mobile sidebar and the record side panel.

### `ui-confirm-dialog`

Declarative delete confirmation with the dependency list.
inputs: `open` (two-way), `title`, `message: string | null`, `confirmLabel`,
`danger` (true), `busy`, `dependents: { entity: string; id: string; label: string; predicate: string }[] | null`,
`reassignOptions: Ref[] | null`, `reassignTo: string | null` (two-way).
outputs: `confirmed: void`, `reassignToChange`. When `dependents` is non-empty the
dialog lists them ("deleting this hospital empties 3 departments…") before the
button is enabled.

### `ui-toast-host`

Renders `ToastService` (`core/toast/toast.service.ts`) — read its API, it is
already written. Fixed bottom-end stack, `role="status" aria-live="polite"`,
auto-dismiss (its `duration`), manual close, colour per `ToastKind`, icon per
kind, max 5 visible, Enter/Esc dismiss the front toast. Place it **once** in
`app.component.html`.

### `ui-tooltip` — directive

`[uiTooltip]="'Server-side sorting'"`, `position: 'top'|'bottom'|'left'|'right'`,
delay 250 ms, `role="tooltip"`, no tooltip on touch-only focus, closes on Escape.
Selector: `[uiTooltip]`, exported as `UiTooltipDirective`.

### `ui-dropdown`

```html
<ui-dropdown [items]="menu()" (itemSelect)="run($event)">
  <span trigger>…</span>
</ui-dropdown>
```

`items: DropdownItem[]` = `{ id: string; label: string; icon?: IconName; danger?: boolean; disabled?: boolean; separator?: boolean }`,
output `itemSelect: DropdownItem`. `trigger` slot (`[uiDropdownTrigger]` directive)
or `triggerIcon` convenience input. Keyboard: Down/Up/Enter/Escape, type-ahead by
first letter, closes on outside click and scroll, `aria-expanded`,
`aria-haspopup="menu"`. `align: 'start'|'end'`.

### `ui-alert`

`kind: 'info'|'success'|'warning'|'danger'`, `title: string | null`,
`dismissible: boolean`, `icon: IconName | null` (defaults per kind), output
`dismissed`. Static inline banner, not a toast.

### `ui-empty-state` / `ui-error-state`

- `ui-empty-state`: `icon`, `title`, `hint`, projected action slot.
- `ui-error-state`: `title`, `message: string`, `hint: string | null`,
  `output` `retry: void`, `icon` default `'triangle-alert'`.

### `ui-stepper`

`steps: { id: string; label: string; hint?: string }[]`, two-way `index: number`,
`linear: boolean` (true), `completed: boolean[]` input optional, outputs
`next`, `back`, `finish`. Renders the horizontal progress header; the body is the
caller's `@if (index() === n)` block. Used by the patient appointment request.

---

## 4. Page furniture

### `ui-page-header`

`title: string`, `subtitle: string | null`, `icon: IconName | null`,
`back: boolean | string` (true = history back, string = routerLink),
projected `[uiPageActions]` slot for the buttons, projected `[uiPageMeta]` slot
for chips/badges under the title. Sticky on desktop, no fixed height.

### `ui-filter-bar`

URL-synced filter chips, bound to `UrlListState` (`core/util/list-state.ts`).

```html
<ui-filter-bar [filters]="specs()" [values]="state.params()" (change)="state.patch($event)" (clear)="state.clearAll()" />
```

```ts
export type FilterSpec =
  | { kind: 'search'; label: string; placeholder: string }            // writes ListParams.q
  | { kind: 'select'; field: string; label: string; options: SelectOption[] }
  | { kind: 'multi'; field: string; label: string; options: SelectOption[] }   // comma-joined value
  | { kind: 'entity'; field: string; label: string; entity: EntityKey; optionLoader: (key: EntityKey) => Observable<Ref[]> }
  | { kind: 'range'; fields: [string, string]; label: string; unit?: string; min?: number; max?: number }
  | { kind: 'dateRange'; fields: [string, string]; label: string }     // ['dateFrom','dateTo']
  | { kind: 'toggle'; field: string; label: string };                  // 'true' / absent
export type FilterPatch = Partial<import('../../core/util/list-state').ListParams>;
```

`optionLoader` is injected as a function (usually
`(key) => inject(EntitiesService).refs(key)`) so the bar stays free of service
dependencies and is trivially testable.

`values` is the page's `ListParams` (`core/util/list-state.ts`); every spec
except `search` reads and writes `values.filters[field]`, so the chip row, the
URL and the request stay the same object. `change` emits a `Partial<ListParams>`
ready for `UrlListState.patch`, `clear` emits void. The field names must be
taken from `EntityMeta.filterable`, which the back-end serves per entity
(`ageGroup`, `minAge`, `maxAge`, `dateFrom`, `dateTo`, `upcoming`, `chronic`,
`emergency`, `type`, `category`, `class`, `department`, `hospital`, `doctor`,
`patient`, `disease`, `symptom`, `treatment`, `medication`, `status`, `gender`).

Renders one control per spec (search debounced 300 ms), and below them the
active-filters chip row (`ui-chip`, removable) + a "clear all" ghost button.

### `ui-breadcrumb`

`crumbs: { label: string; href?: string | null }[]`, last one is plain text
(`aria-current="page"`), separator `chevron-right`, uses `routerLink`.

### `ui-search-box`

`placeholder`, `value: string` two-way (`model`), `debounceMs: number` (300),
`loading: boolean`, `hint: string | null`. Enter emits `submitted`.

---

## 5. Charts (`ui-chart`)

`ng2-charts` + `chart.js` are installed.

```html
<ui-chart type="line" [labels]="months()" [series]="counts()" height="260px" />
<ui-chart type="doughnut" [data]="byStatus()" height="260px" />
```

```ts
type ChartType = 'line' | 'bar' | 'doughnut' | 'pie';
inputs: type: ChartType, labels: string[], data: number[] | number[][] ,
        names?: string[] /* legend per series when data is number[][] */,
        height: string ('280px'), stacked: boolean, legend: boolean (auto),
        colors: string[] | null /* overrides, otherwise the palette below */
```

Palette must be derived from the brand tokens: `#2563EB`, `#14B8A6`, `#8B5CF6`,
`#0EA5E9`, `#F59E0B`, `#10B981`, `#EF4444`, `#64748B`. Grid lines
`var(--chart-grid)`, tick colour `--text-muted`, tooltips theme-aware,
`maintainAspectRatio: false`, animation 200 ms (off when reduced motion).
Canvas must have an `aria-label` and the component must render a data table
alternative for screen readers (`visually-hidden` table of the same numbers).

---

## 6. What already exists (do not re-create)

| thing | path |
| --- | --- |
| design tokens / base / utilities / forms / print | `src/styles/*.scss` |
| icon set + `ui-icon` | `src/app/shared/ui/icon/` |
| focus trap directive | `src/app/shared/ui/focus-trap.directive.ts` |
| toast service (state only, no host yet) | `src/app/core/toast/toast.service.ts` |
| theme service | `src/app/core/theme/theme.service.ts` |
| i18n (`provideI18n`, `LangService`, `I18nLoader`) | `src/app/core/i18n/i18n.ts` |
| auth / guards / interceptors | `src/app/core/auth/` |
| API services and wire types | `src/app/core/api/` |
| formatters, csv download, URL list state | `src/app/core/util/` |
