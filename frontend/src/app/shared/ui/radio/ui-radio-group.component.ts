import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NG_VALUE_ACCESSOR,
  NgControl,
  type ControlValueAccessor,
  type ValidationErrors,
} from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { translateOrText } from '../../../core/util/labels';
import type { SelectOption } from '../select/ui-select.component';
import type { FieldErrorEntry } from '../input/ui-input.component';

let uiRadioSequence = 0;

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

/**
 * Single choice among a small set. Every option is a real radio input sharing
 * one `name`, which is what gives the group its native arrow-key behaviour.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-radio-group',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiRadioGroupComponent), multi: true }],
  template: `
    <fieldset class="ui-field group" role="radiogroup" [attr.aria-labelledby]="legendId">
      <legend class="ui-label" [id]="legendId" [class.ui-label--required]="required()">
        {{ text(label()) }}
      </legend>

      <div class="list" [class.list--row]="layout() === 'row'">
        @for (option of options(); track textOf(option.value)) {
          <label class="radio" [attr.for]="optionId($index)">
            <span class="dotbox">
              <input
                class="real"
                type="radio"
                [id]="optionId($index)"
                [name]="groupName()"
                [value]="textOf(option.value)"
                [checked]="isSelected(option.value)"
                [attr.disabled]="choiceDisabled(option) ? '' : null"
                [attr.required]="required() ? '' : null"
                [attr.aria-required]="required() || null"
                [attr.aria-invalid]="hasErrors() ? 'true' : null"
                [attr.aria-describedby]="describedBy()"
                (change)="onPick($event)"
                (blur)="onBlur()"
              />
              <span class="dot" aria-hidden="true"></span>
            </span>
            <span class="choice">{{ text(option.label) }}</span>
          </label>
        }
      </div>

      @if (hint() !== null) {
        <p class="ui-hint" [id]="hintId">{{ text(hint()) }}</p>
      }
      @if (errorEntries().length > 0) {
        <div class="errors" [id]="errorsId" aria-live="polite">
          @for (entry of errorEntries(); track entry.key) {
            <p class="ui-error">{{ entry.key | translate: entry.params }}</p>
          }
        </div>
      }
    </fieldset>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .group {
        border: 0;
        margin: 0;
        padding: 0;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .list--row {
        flex-direction: row;
        flex-wrap: wrap;
        gap: var(--sp-4);
      }
      .radio {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        cursor: pointer;
      }
      .dotbox {
        position: relative;
        display: inline-flex;
        flex: none;
        width: var(--sp-4);
        height: var(--sp-4);
      }
      .real {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        opacity: 0;
        cursor: inherit;
      }
      .dot {
        display: block;
        width: 100%;
        height: 100%;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-pill);
        background: var(--surface);
        transition:
          border-color var(--duration) var(--ease),
          box-shadow var(--duration) var(--ease);
      }
      .dot::after {
        content: '';
        position: absolute;
        inset: 25%;
        border-radius: var(--radius-pill);
        background: var(--primary);
        opacity: 0;
        transition: opacity var(--duration) var(--ease);
      }
      .real:checked + .dot {
        border-color: var(--primary);
      }
      .real:checked + .dot::after {
        opacity: 1;
      }
      .real:focus-visible + .dot {
        box-shadow: var(--focus-ring);
        border-color: var(--primary);
      }
      .real:disabled + .dot {
        background: var(--bg-sunken);
        border-color: var(--border);
      }
      .real[aria-invalid='true'] + .dot {
        border-color: var(--danger-500);
      }
      .choice {
        font-size: var(--fs-sm);
        color: var(--text);
      }
      .real:disabled ~ .choice {
        color: var(--text-subtle);
      }
      .errors {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
    `,
  ],
})
export class UiRadioGroupComponent implements OnInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly options = input<SelectOption[]>([]);
  readonly name = input<string | null>(null);
  readonly layout = input<'row' | 'column'>('column');
  readonly hint = input<string | null>(null);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly errors = input<readonly string[] | null>(null);

  readonly groupId = `ui-radio-${++uiRadioSequence}`;
  readonly legendId = `${this.groupId}-legend`;
  readonly hintId = `${this.groupId}-hint`;
  readonly errorsId = `${this.groupId}-errors`;

  protected readonly selected = signal<string | number | null>(null);
  private readonly formDisabled = signal(false);
  private readonly stateTick = signal(0);

  private readonly injector = inject(Injector);
  private ngControl: NgControl | null = null;
  private readonly cd = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  private propagate: (value: string | number | null) => void = () => {};
  private touch: () => void = () => {};

  ngOnInit(): void {
    this.ngControl = this.injector.get(NgControl, null, { self: true });
    const control = this.ngControl?.control;
    if (!control) return;
    control.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.stateTick.update((tick) => tick + 1);
      this.cd.markForCheck();
    });
  }

  protected readonly groupName = computed(() => this.name() ?? this.groupId);

  protected readonly isDisabled = computed(() => {
    this.stateTick();
    return this.disabled() || this.formDisabled() || (this.ngControl?.control?.disabled ?? false);
  });

  protected choiceDisabled(option: SelectOption): boolean {
    return this.isDisabled() || option.disabled === true;
  }

  protected optionId(index: number): string {
    return `${this.groupId}-${index}`;
  }

  textOf(value: string | number): string {
    return String(value);
  }

  protected isSelected(value: string | number): boolean {
    const current = this.selected();
    return current !== null && this.textOf(current) === this.textOf(value);
  }

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

  protected text(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  protected readonly describedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.hint() !== null) ids.push(this.hintId);
    if (this.hasErrors()) ids.push(this.errorsId);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  protected onPick(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const match = this.options().find((option) => this.textOf(option.value) === raw);
    const value = match ? match.value : raw;
    this.selected.set(value);
    this.propagate(value);
  }

  protected onBlur(): void {
    this.touch();
    this.stateTick.update((tick) => tick + 1);
  }

  writeValue(raw: unknown): void {
    if (raw === null || raw === undefined || raw === '') {
      this.selected.set(null);
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      this.selected.set(raw);
    } else {
      this.selected.set(String(raw));
    }
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
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
