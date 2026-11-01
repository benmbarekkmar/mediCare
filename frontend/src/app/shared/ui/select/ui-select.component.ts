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
import type { FieldErrorEntry } from '../input/ui-input.component';

/** The one option shape every choice control consumes. */
export type SelectOption = { value: string | number; label: string; disabled?: boolean };

let uiSelectSequence = 0;

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
    const min = details['min'];
    if (key === 'min' && typeof min === 'number') params['min'] = min;
    const max = details['max'];
    if (key === 'max' && typeof max === 'number') params['max'] = max;
    return { key: `errors.field.${key}`, params };
  });
};

/**
 * Native `<select>` wearing the shared skin: native keyboard and mobile pickers
 * stay reliable, the value is the option's own `value` (string or number).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-select',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiSelectComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="ui-label" [class.ui-label--required]="required()" [attr.for]="inputId">
        {{ text(label()) }}
      </label>

      <select
        class="ui-control"
        [id]="inputId"
        [value]="selectedText()"
        [attr.disabled]="isDisabled() ? '' : null"
        [attr.required]="required() ? '' : null"
        [attr.aria-required]="required() || null"
        [attr.aria-invalid]="hasErrors() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        [attr.name]="name()"
        (change)="onChange($event)"
        (blur)="onBlur()"
      >
        <option value="" [disabled]="!allowEmpty()" [hidden]="!allowEmpty()">
          {{ text(placeholder() ?? 'ui.select.placeholder') }}
        </option>
        @for (option of options(); track optionKey(option)) {
          <option [value]="textOf(option.value)" [disabled]="option.disabled === true">
            {{ text(option.label) }}
          </option>
        }
      </select>

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
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .errors {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
    `,
  ],
})
export class UiSelectComponent implements OnInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly options = input<SelectOption[]>([]);
  readonly hint = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly allowEmpty = input<boolean>(false);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly name = input<string | null>(null);
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-select-${++uiSelectSequence}`;
  readonly hintId = `${this.inputId}-hint`;
  readonly errorsId = `${this.inputId}-errors`;

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

  textOf(value: string | number): string {
    return String(value);
  }

  protected text(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  protected optionKey(option: SelectOption): string {
    return `${this.textOf(option.value)}-${option.label}`;
  }

  protected readonly selectedText = computed<string>(() => {
    const value = this.selected();
    return value === null || value === undefined ? '' : this.textOf(value);
  });

  protected onChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const match = this.options().find((option) => this.textOf(option.value) === raw);
    const value = match ? match.value : raw === '' ? null : raw;
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
