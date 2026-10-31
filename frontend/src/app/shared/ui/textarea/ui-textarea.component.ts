import {
  AfterViewInit,
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

let uiTextareaSequence = 0;

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
 * Multi-line field: the same `ui-field` grammar as `ui-input`, plus an optional
 * character counter. ControlValueAccessor, so reactive forms and ngModel work.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-textarea',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiTextareaComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="ui-label" [class.ui-label--required]="required()" [attr.for]="inputId">
        {{ displayText(label()) }}
      </label>

      <textarea
        class="ui-control"
        [id]="inputId"
        [rows]="rows()"
        [value]="value()"
        [placeholder]="displayText(placeholder())"
        [attr.disabled]="isDisabled() ? '' : null"
        [attr.required]="required() ? '' : null"
        [attr.aria-required]="required() || null"
        [attr.aria-invalid]="hasErrors() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        [attr.maxlength]="maxCharacters()"
        [attr.name]="name()"
        (input)="onInput($event)"
        (blur)="onBlur()"
      ></textarea>

      <div class="foot">
        @if (hint() !== null) {
          <p class="ui-hint" [id]="hintId">{{ displayText(hint()) }}</p>
        }
        @if (maxCharacters() !== null) {
          <p class="counter" [id]="counterId" [class.counter--over]="isOver()">
            {{ 'ui.input.characters' | translate: { count: value().length, max: counterMax() } }}
          </p>
        }
      </div>

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
      .foot {
        display: flex;
        align-items: baseline;
        gap: var(--sp-3);
      }
      .counter {
        margin: 0;
        margin-inline-start: auto;
        font-size: var(--fs-xs);
        color: var(--text-subtle);
      }
      .counter--over {
        color: var(--danger-500);
      }
      .errors {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
    `,
  ],
})
export class UiTextareaComponent implements OnInit, AfterViewInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly placeholder = input<string>('');
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly rows = input<number>(4);
  readonly maxCharacters = input<number | null>(null);
  readonly name = input<string | null>(null);
  readonly autofocus = input<boolean>(false);
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-textarea-${++uiTextareaSequence}`;
  readonly hintId = `${this.inputId}-hint`;
  readonly counterId = `${this.inputId}-counter`;
  readonly errorsId = `${this.inputId}-errors`;

  protected readonly value = signal('');
  private readonly formDisabled = signal(false);
  private readonly stateTick = signal(0);

  private readonly injector = inject(Injector);
  private ngControl: NgControl | null = null;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cd = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  private propagate: (value: string) => void = () => {};
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

  ngAfterViewInit(): void {
    if (!this.autofocus()) return;
    (this.host.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
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

  protected displayText(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  protected readonly describedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.hint() !== null) ids.push(this.hintId);
    if (this.maxCharacters() !== null) ids.push(this.counterId);
    if (this.hasErrors()) ids.push(this.errorsId);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  protected readonly counterMax = computed<number>(() => this.maxCharacters() ?? 0);

  protected readonly isOver = computed(
    () => this.maxCharacters() !== null && this.value().length > this.counterMax(),
  );

  protected onInput(event: Event): void {
    const next = (event.target as HTMLTextAreaElement).value;
    this.value.set(next);
    this.propagate(next);
  }

  protected onBlur(): void {
    this.touch();
    this.stateTick.update((tick) => tick + 1);
  }

  writeValue(raw: unknown): void {
    this.value.set(raw === null || raw === undefined ? '' : String(raw));
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: string) => void): void {
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
