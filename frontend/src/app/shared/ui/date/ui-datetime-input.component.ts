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
import { toDateTimeInput } from '../../../core/util/format';
import { translateOrText } from '../../../core/util/labels';
import type { FieldErrorEntry } from '../input/ui-input.component';

let uiDatetimeSequence = 0;

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

/** XSD `yyyy-mm-ddThh:mm`, the shape `<input type="datetime-local">` expects. */
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const compare = (value: string, bound: string): number => {
  const left = value.length >= bound.length ? value.slice(0, bound.length) : value;
  if (left < bound) return -1;
  return left > bound ? 1 : 0;
};

/**
 * Validated wrapper over `<input type="datetime-local">`. The form value is the
 * raw `yyyy-mm-ddThh:mm` string; API instants (with seconds or a zone) are
 * normalised through `toDateTimeInput` before they reach the field.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-datetime-input',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiDatetimeInputComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="ui-label" [class.ui-label--required]="required()" [attr.for]="inputId">
        {{ text(label()) }}
      </label>

      <input
        class="ui-control"
        type="datetime-local"
        [id]="inputId"
        [value]="value()"
        [attr.min]="min()"
        [attr.max]="max()"
        [attr.step]="step()"
        [attr.disabled]="isDisabled() ? '' : null"
        [attr.required]="required() ? '' : null"
        [attr.aria-required]="required() || null"
        [attr.aria-invalid]="errorEntries().length > 0 ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        (input)="onInput($event)"
        (change)="onInput($event)"
        (blur)="onBlur()"
      />

      @if (hint() !== null) {
        <p class="ui-hint" [id]="hintId">{{ text(hint()) }}</p>
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
      .errors {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
    `,
  ],
})
export class UiDatetimeInputComponent implements OnInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly step = input<number | null>(null);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-datetime-${++uiDatetimeSequence}`;
  readonly hintId = `${this.inputId}-hint`;
  readonly errorsId = `${this.inputId}-errors`;

  protected readonly value = signal('');
  private readonly formDisabled = signal(false);
  private readonly interacted = signal(false);
  private readonly stateTick = signal(0);

  private readonly injector = inject(Injector);
  private ngControl: NgControl | null = null;
  private readonly cd = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  private propagate: (value: string | null) => void = () => {};
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
    if (control) return control.touched || control.dirty;
    return this.interacted();
  });

  protected readonly localErrors = computed<FieldErrorEntry[]>(() => {
    const value = this.value();
    if (value.length === 0) return [];
    const entries: FieldErrorEntry[] = [];
    if (!DATETIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
      entries.push({ key: 'ui.date.invalid', params: {} });
      return entries;
    }
    const min = this.min();
    if (min !== null && compare(value, min) < 0) entries.push({ key: 'ui.date.after', params: { date: min } });
    const max = this.max();
    if (max !== null && compare(value, max) > 0) entries.push({ key: 'ui.date.before', params: { date: max } });
    return entries;
  });

  protected readonly errorEntries = computed<FieldErrorEntry[]>(() => {
    const override = this.errors();
    if (override && override.length > 0) return override.map((key) => ({ key, params: {} }));
    if (!this.showErrors()) return [];
    const invalid = this.localErrors();
    if (invalid.length > 0) return invalid;
    return toEntries(this.ngControl?.control?.errors ?? null);
  });

  protected readonly describedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.hint() !== null) ids.push(this.hintId);
    if (this.errorEntries().length > 0) ids.push(this.errorsId);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  protected text(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.interacted.set(true);
    this.propagate(next.length === 0 ? null : next);
  }

  protected onBlur(): void {
    this.interacted.set(true);
    this.touch();
    this.stateTick.update((tick) => tick + 1);
  }

  writeValue(raw: unknown): void {
    const text = raw === null || raw === undefined ? '' : String(raw);
    this.value.set(text.length === 0 ? '' : toDateTimeInput(text));
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: string | null) => void): void {
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
