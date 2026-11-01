import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Injector,
  ElementRef,
  OnInit,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Overlay, OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NG_VALUE_ACCESSOR,
  NgControl,
  type ControlValueAccessor,
  type ValidationErrors,
} from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { Observable } from 'rxjs';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';
import type { Ref } from '../../../core/api/models';
import { translateOrText } from '../../../core/util/labels';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { FieldErrorEntry } from '../input/ui-input.component';

let uiComboboxSequence = 0;

const toEntries = (errors: ValidationErrors | null): FieldErrorEntry[] => {
  if (!errors) return [];
  return Object.keys(errors).map((key) => {
    const raw: unknown = errors[key];
    const details = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const params: Record<string, string | number> = {};
    const requiredLength = details['requiredLength'];
    if ((key === 'minlength' || key === 'maxlength') && typeof requiredLength === 'number') {
      params['requiredLength'] = requiredLength;
    }
    return { key: `errors.field.${key}`, params };
  });
};

/** A chip whose `Ref` is still unknown: the form only gave us its id. */
const refFromId = (id: string): Ref => ({ id, iri: '', label: id, type: '' });

/**
 * Async autocomplete over the API `Ref`s. The search function arrives as an
 * input so the component stays free of services and is trivially testable:
 * typing debounces 300 ms, `switchMap` lets the last response win, and the CVA
 * value is a `string[]` of ids (a single `string` when `multiple` is false).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-combobox',
  standalone: true,
  imports: [TranslateModule, UiIconComponent, OverlayModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiComboboxComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="ui-label" [class.ui-label--required]="required()" [attr.for]="inputId">
        {{ displayText(label()) }}
      </label>

      <div class="shell">
        @if (multiple() && chips().length > 0) {
          <ul class="chips" [attr.aria-label]="'uiforms.combobox.chipsLabel' | translate">
            @for (chip of visibleChips(); track chip.id) {
              <li class="chip">
                <span class="chip__label">{{ chip.label }}</span>
                <button
                  class="chip__remove"
                  type="button"
                  [attr.aria-label]="'ui.combobox.remove' | translate: { label: chip.label }"
                  [disabled]="isDisabled()"
                  (click)="removeChip(chip.id)"
                >
                  <ui-icon name="x" size="14" />
                </button>
              </li>
            }
            @if (hiddenChipCount() > 0) {
              <li class="chip chip--rest">
                {{ 'ui.combobox.more' | translate: { count: hiddenChipCount() } }}
              </li>
            }
          </ul>
        }

        <div class="input-row" cdkOverlayOrigin #trigger="cdkOverlayOrigin">
          <input
            class="ui-control"
            role="combobox"
            type="text"
            [id]="inputId"
            [value]="text()"
            [attr.placeholder]="displayText(placeholder() ?? 'ui.combobox.placeholder')"
            [attr.disabled]="isDisabled() ? '' : null"
            [attr.required]="required() ? '' : null"
            aria-haspopup="listbox"
            autocomplete="off"
            [attr.aria-required]="required() || null"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="listId"
            [attr.aria-activedescendant]="activeDescendant()"
            [attr.aria-invalid]="hasErrors() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            (keydown)="onKeydown($event)"
            (input)="onInput($event)"
            (click)="toggleDropdown()"
            (blur)="onBlur()"
          />

          <ui-icon class="caret" name="chevron-down" size="16" />
        </div>

        <ng-template
          cdkConnectedOverlay
          [cdkConnectedOverlayOrigin]="trigger"
          [cdkConnectedOverlayOpen]="open()"
          [cdkConnectedOverlayPositions]="dropdownPositions"
          [cdkConnectedOverlayScrollStrategy]="dropdownScrollStrategy"
          [cdkConnectedOverlayWidth]="trigger.elementRef.nativeElement.clientWidth"
          [cdkConnectedOverlayViewportMargin]="8"
          [cdkConnectedOverlayFlexibleDimensions]="true"
          [cdkConnectedOverlayPush]="true"
          (overlayOutsideClick)="close()"
        >
          <ul class="list" [style.max-height.px]="dropdownMaxHeight" [id]="listId" role="listbox" [attr.aria-label]="'uiforms.combobox.listLabel' | translate">
            @if (loading()) {
              <li class="list__status">
                <ui-icon class="list__spinner" name="loader" size="16" />
                <span>{{ 'ui.combobox.searching' | translate }}</span>
              </li>
            } @else {
              @for (ref of results(); track ref.id) {
                <li
                  class="list__option"
                  [id]="optionId($index)"
                  role="option"
                  [attr.aria-selected]="isSelected(ref.id)"
                  [class.list__option--active]="$index === activeIndex()"
                  [class.list__option--picked]="isSelected(ref.id)"
                  (mousedown)="$event.preventDefault()"
                  (click)="pick(ref)"
                >
                  <span class="list__label">{{ ref.label }}</span>
                  @if (isSelected(ref.id)) {
                    <ui-icon class="list__check" name="check" size="14" />
                    <span class="visually-hidden">{{ 'uiforms.combobox.selected' | translate }}</span>
                  }
                </li>
              }
              @if (results().length === 0) {
                <li class="list__status">
                  @if (emptyMessage() !== null) {
                    <span>{{ displayText(emptyMessage()) }}</span>
                  } @else {
                    <span>{{ 'ui.combobox.noOptions' | translate }}</span>
                  }
                </li>
              }
            }
          </ul>
        </ng-template>
      </div>

      @if (hint() !== null) {
        <p class="ui-hint" [id]="hintId">{{ displayText(hint()) }}</p>
      }
      @if (errorEntries().length > 0) {
        <div class="errors" [id]="errorsId" aria-live="polite">
          @for (entry of errorEntries(); track entry.key + $index) {
            <p class="ui-error">{{ entry.key | translate: entry.params }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .shell {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
      .input-row {
        position: relative;
        display: flex;
        align-items: center;
      }
      .ui-control {
        padding-inline-end: var(--sp-8);
        cursor: pointer;
        caret-color: transparent;
        user-select: none;
      }
      .caret {
        position: absolute;
        inset-inline-end: var(--sp-4);
        color: var(--text-subtle);
        pointer-events: none;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        padding: var(--sp-1) var(--sp-2);
        font-size: var(--fs-xs);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--primary-soft);
        color: var(--text);
      }
      .chip--rest {
        background: var(--bg-sunken);
        color: var(--text-muted);
      }
      .chip__label {
        max-width: calc(var(--sp-8) * 3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip__remove {
        display: inline-flex;
        align-items: center;
        padding: 0;
        border: 0;
        border-radius: var(--radius-pill);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
      }
      .chip__remove:hover:not(:disabled) {
        color: var(--danger-500);
      }
      .chip__remove:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .list {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        width: 100%;
        max-height: min(calc(var(--sp-8) * 5), calc(100dvh - var(--sp-6)));
        margin: 0;
        padding: var(--sp-1);
        list-style: none;
        overflow: auto;
        overscroll-behavior: contain;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        box-shadow: var(--shadow-md);
      }
      .list__option,
      .list__status {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-2);
        font-size: var(--fs-sm);
        border-radius: var(--radius-input);
        color: var(--text);
      }
      .list__option {
        cursor: pointer;
      }
      .list__option:hover {
        background: var(--bg-hover);
      }
      .list__option--active {
        background: var(--primary-soft);
        outline: 1px solid var(--primary);
      }
      .list__option--picked {
        color: var(--primary);
      }
      .list__label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .list__check {
        margin-inline-start: auto;
        color: var(--primary);
      }
      .list__status {
        color: var(--text-subtle);
      }
      .list__spinner {
        animation: uiComboboxSpin 800ms linear infinite;
      }
      @keyframes uiComboboxSpin {
        to {
          transform: rotate(360deg);
        }
      }
      .errors {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
    `,
  ],
})
export class UiComboboxComponent implements OnInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly search = input.required<(term: string) => Observable<Ref[]>>();
  readonly initial = input<Ref[] | Ref | null>(null);
  readonly multiple = input<boolean>(false);
  readonly maxChips = input<number>(5);
  readonly hint = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly emptyMessage = input<string | null>(null);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-combobox-${++uiComboboxSequence}`;
  readonly listId = `${this.inputId}-list`;
  readonly hintId = `${this.inputId}-hint`;
  readonly errorsId = `${this.inputId}-errors`;

  protected readonly text = signal('');
  private readonly typeahead = signal('');
  protected readonly results = signal<Ref[]>([]);
  protected readonly loading = signal(false);
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);
  private readonly known = signal<ReadonlyMap<string, Ref>>(new Map());
  /** `null` means the form has not chosen yet, so `initial` decides. */
  private readonly explicitIds = signal<string[] | null>(null);
  private readonly formDisabled = signal(false);
  private readonly stateTick = signal(0);

  private readonly injector = inject(Injector);
  private ngControl: NgControl | null = null;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly overlay = inject(Overlay);
  private readonly belowFirstPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  private readonly aboveFirstPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  ];
  protected readonly dropdownScrollStrategy = this.overlay.scrollStrategies.reposition({ scrollThrottle: 16 });

  protected get dropdownPositions(): ConnectedPosition[] {
    const { above, below } = this.dropdownSpace();
    return below >= above ? this.belowFirstPositions : this.aboveFirstPositions;
  }

  protected get dropdownMaxHeight(): number {
    const { above, below } = this.dropdownSpace();
    return Math.min(320, Math.max(above, below));
  }

  private dropdownSpace(): { above: number; below: number } {
    const root = this.host.nativeElement;
    const view = root.ownerDocument.defaultView;
    const origin = root.querySelector('.input-row') as HTMLElement | null;
    if (!view || !origin) return { above: 320, below: 320 };

    const panel = (root.closest('.ui-modal') as HTMLElement | null)?.getBoundingClientRect();
    const originRect = origin.getBoundingClientRect();
    const top = Math.max(8, (panel?.top ?? 0) + (panel ? 8 : 0));
    const bottom = Math.min(view.innerHeight - 8, (panel?.bottom ?? view.innerHeight) - (panel ? 8 : 0));
    return {
      above: Math.max(0, originRect.top - top - 4),
      below: Math.max(0, bottom - originRect.bottom - 4),
    };
  }
  private readonly cd = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queries = new Subject<string>();

  private propagate: (value: string[] | string | null) => void = () => {};
  private touch: () => void = () => {};

  ngOnInit(): void {
    this.ngControl = this.injector.get(NgControl, null, { self: true });
    this.remember(this.seed());

    this.queries
      .pipe(
        debounceTime(300),
        switchMap((term) => this.runSearch(term)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((refs) => {
        this.remember(refs);
        this.results.set(refs);
        this.loading.set(false);
        this.activeIndex.set(refs.length > 0 ? 0 : -1);
        if (this.multiple()) this.text.set('');
        this.cd.markForCheck();
      });

    const control = this.ngControl?.control;
    if (!control) return;
    control.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.stateTick.update((tick) => tick + 1);
      this.cd.markForCheck();
    });
  }

  protected readonly isDisabled = computed(() => {
    this.stateTick();
    return this.disabled() || this.formDisabled() || (this.ngControl?.control?.disabled ?? false);
  });

  protected readonly showErrors = computed(() => {
    this.stateTick();
    const control = this.ngControl?.control;
    if (!control) return false;
    return control.touched || control.dirty;
  });

  protected readonly errorEntries = computed<FieldErrorEntry[]>(() => {
    const override = this.errors();
    if (override && override.length > 0) return override.map((key) => ({ key, params: {} }));
    const control = this.ngControl?.control;
    if (!control || !this.showErrors()) return [];
    return toEntries(control.errors);
  });

  protected readonly hasErrors = computed(() => this.errorEntries().length > 0);

  protected readonly describedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.hint() !== null) ids.push(this.hintId);
    if (this.hasErrors()) ids.push(this.errorsId);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  protected displayText(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  private readonly seed = computed<Ref[]>(() => {
    const raw = this.initial();
    if (raw === null) return [];
    return Array.isArray(raw) ? raw : [raw];
  });

  protected readonly selectedIds = computed<string[]>(() => {
    const explicit = this.explicitIds();
    if (explicit !== null) return explicit;
    return this.seed().map((ref) => ref.id);
  });

  protected readonly chips = computed<Ref[]>(() => this.selectedIds().map((id) => this.refOf(id)));

  protected readonly visibleChips = computed<Ref[]>(() => this.chips().slice(0, this.maxChips()));

  protected readonly hiddenChipCount = computed<number>(() => {
    const extra = this.chips().length - this.maxChips();
    return extra > 0 ? extra : 0;
  });

  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected activeDescendant(): string | null {
    if (!this.open() || this.activeIndex() < 0) return null;
    return this.optionId(this.activeIndex());
  }

  protected toggleDropdown(): void {
    if (this.isDisabled()) return;
    if (this.open()) this.close();
    else this.searchNow();
  }

  protected onBlur(): void {
    this.touch();
    this.stateTick.update((tick) => tick + 1);
    this.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.isDisabled()) return;
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) this.searchNow();
        else this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (this.open()) this.move(-1);
        else this.searchNow();
        break;
      case 'Home':
        if (this.open() && count > 0) {
          event.preventDefault();
          this.activeIndex.set(0);
          this.scrollActiveIntoView();
        }
        break;
      case 'End':
        if (this.open() && count > 0) {
          event.preventDefault();
          this.activeIndex.set(count - 1);
          this.scrollActiveIntoView();
        }
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (!this.open()) {
          this.searchNow();
          break;
        }
        const picked = this.results()[this.activeIndex()];
        if (picked !== undefined) this.pick(picked);
        break;
      }
      case 'Escape':
        if (!this.open()) return;
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      case 'Backspace': {
        const query = this.typeahead();
        const hasSelection = this.selectedIds().length > 0;
        if (query.length > 0) {
          event.preventDefault();
          this.searchFor(query.slice(0, -1));
        } else if (this.multiple() && hasSelection) {
          event.preventDefault();
          this.removeLastChip();
        } else if (!this.multiple() && hasSelection) {
          event.preventDefault();
          this.clearAll();
        }
        break;
      }
      default:
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          this.searchFor((this.typeahead() + event.key).slice(0, 80));
        }
        break;
    }
  }

  protected onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.slice(0, 80);
    this.text.set(value);
    this.searchFor(value);
  }

  protected pick(ref: Ref): void {
    this.remember([ref]);
    const current = this.selectedIds();
    if (this.multiple()) {
      if (!current.includes(ref.id)) this.explicitIds.set([...current, ref.id]);
      this.text.set('');
    } else {
      this.explicitIds.set([ref.id]);
      this.text.set(ref.label);
      this.close();
    }
    this.emit();
  }

  protected removeChip(id: string): void {
    this.explicitIds.set(this.selectedIds().filter((current) => current !== id));
    if (!this.multiple()) this.text.set('');
    this.emit();
  }

  protected clearAll(): void {
    this.explicitIds.set([]);
    this.results.set([]);
    this.text.set('');
    this.close();
    this.emit();
  }

  private removeLastChip(): void {
    const ids = this.selectedIds();
    const last = ids[ids.length - 1];
    if (last === undefined) return;
    this.removeChip(last);
  }

  private searchNow(): void {
    this.searchFor('');
  }

  private searchFor(term: string): void {
    this.typeahead.set(term);
    this.loading.set(true);
    this.open.set(true);
    this.queries.next(term);
  }

  private move(delta: number): void {
    const count = this.results().length;
    if (count === 0) {
      this.searchNow();
      return;
    }
    const from = this.activeIndex();
    const next = from < 0 ? (delta > 0 ? 0 : count - 1) : Math.min(count - 1, Math.max(0, from + delta));
    this.activeIndex.set(next);
    this.scrollActiveIntoView();
  }

  private scrollActiveIntoView(): void {
    const option = this.host.nativeElement.ownerDocument.getElementById(this.optionId(this.activeIndex()));
    option?.scrollIntoView({ block: 'nearest' });
  }

  protected close(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  private runSearch(term: string): Observable<Ref[]> {
    return this.search()(term).pipe(catchError(() => of<Ref[]>([])));
  }

  private remember(refs: readonly Ref[]): void {
    if (refs.length === 0) return;
    const next = new Map(this.known());
    for (const ref of refs) next.set(ref.id, ref);
    this.known.set(next);
  }

  private refOf(id: string): Ref {
    const known = this.known().get(id);
    if (known) return known;
    const seeded = this.seed().find((ref) => ref.id === id);
    return seeded ?? refFromId(id);
  }

  private emit(): void {
    const ids = this.selectedIds();
    this.propagate(this.multiple() ? ids : (ids[0] ?? null));
  }

  writeValue(raw: unknown): void {
    this.remember(this.seed());
    const isEmpty = raw === null || raw === undefined || raw === '';
    this.explicitIds.set(isEmpty ? null : this.toIds(raw));
    this.syncText();
    this.cd.markForCheck();
  }

  private syncText(): void {
    if (this.multiple()) {
      this.text.set('');
      return;
    }
    const first = this.selectedIds()[0];
    if (first === undefined) {
      if (this.text().length > 0 && this.explicitIds() === null) this.text.set('');
      return;
    }
    this.text.set(this.refOf(first).label);
  }

  private toIds(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((item) => String(item));
    if (typeof raw === 'string' || typeof raw === 'number') return [String(raw)];
    return [];
  }

  registerOnChange(fn: (value: string[] | string | null) => void): void {
    this.propagate = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touch = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
    this.cd.markForCheck();
  }
}
