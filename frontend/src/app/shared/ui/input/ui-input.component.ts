import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Injector,
  ElementRef,
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
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';

/** One translated message per validation failure, with its interpolation params. */
export interface FieldErrorEntry {
  key: string;
  params: Record<string, string | number>;
}

let uiInputSequence = 0;

/** Turns Angular's `ValidationErrors` map into the `errors.field.*` catalogue keys. */
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
 * Text-like field built on the shared `ui-field` grammar: label, control, hint,
 * error. It is a `ControlValueAccessor` so `formControlName`, `formControl` and
 * `ngModel` all drive it, and it reads its own injected `NgControl` to print the
 * validation errors with the `errors.field.*` translations.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-input',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiInputComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="ui-label" [class.ui-label--required]="required()" [attr.for]="inputId">
        {{ text(label()) }}
      </label>

      <div class="ui-control-group">
        <div class="shell" [class.shell--icon]="hasIcon()" [class.shell--trailing]="hasTrailing()">
          @if (hasIcon()) {
            <ui-icon class="shell__icon" [name]="iconName()" [size]="iconSize()" />
          }
          <input
            class="ui-control"
            [class.ui-control--sm]="size() === 'sm'"
            [class.ui-control--lg]="size() === 'lg'"
            [id]="inputId"
            [type]="effectiveType()"
            [value]="value()"
            [placeholder]="text(placeholder())"
            [attr.disabled]="isDisabled() ? '' : null"
            [attr.required]="required() ? '' : null"
            [attr.aria-required]="required() || null"
            [attr.aria-invalid]="hasErrors() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [attr.step]="step()"
            [attr.min]="min()"
            [attr.max]="max()"
            [attr.name]="name()"
            [attr.autocomplete]="autocomplete()"
            (input)="onInput($event)"
            (blur)="onBlur()"
          />
          @if (isPassword()) {
            <button
              class="shell__toggle"
              type="button"
              [attr.aria-label]="(revealed() ? 'ui.input.hidePassword' : 'ui.input.showPassword') | translate"
              [attr.aria-pressed]="revealed()"
              (click)="toggleReveal()"
            >
              <ui-icon [name]="revealed() ? 'eye-off' : 'eye'" size="16" />
            </button>
          }
        </div>
        @if (suffix() !== null) {
          <span class="ui-control-addon">{{ text(suffix()) }}</span>
        }
      </div>

      @if (hint() !== null) {
        <p class="ui-hint" [id]="hintId">{{ text(hint()) }}</p>
      }
      @if (errorEntries().length > 0) {
        <div class="errors" [id]="errorsId" aria-live="polite">
          @for (entry of errorEntries(); track entry.key) {
            <p class="ui-error">
              <ui-icon name="circle-alert" size="14" />
              <span>{{ entry.key | translate: entry.params }}</span>
            </p>
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
        align-items: center;
        flex: 1 1 auto;
        min-width: 0;
      }
      .shell__icon {
        position: absolute;
        inset-inline-start: var(--sp-3);
        color: var(--text-subtle);
        pointer-events: none;
      }
      .shell--icon .ui-control {
        padding-inline-start: calc(var(--sp-6) + var(--sp-2));
      }
      .shell--trailing .ui-control {
        padding-inline-end: calc(var(--sp-6) + var(--sp-2));
      }
      .shell__toggle {
        position: absolute;
        inset-inline-end: var(--sp-2);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--sp-1);
        border: 0;
        border-radius: var(--radius-input);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        transition: color var(--duration) var(--ease), background var(--duration) var(--ease);
      }
      .shell__toggle:hover {
        color: var(--primary);
        background: var(--primary-soft);
      }
      .shell__toggle:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .ui-control--sm {
        padding: var(--sp-1) var(--sp-2);
        font-size: var(--fs-xs);
      }
      .ui-control--lg {
        padding: var(--sp-3) var(--sp-4);
        font-size: var(--fs-base);
      }
      .errors {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
    `,
  ],
})
export class UiInputComponent implements AfterViewInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly type = input<'text' | 'email' | 'password' | 'number' | 'tel' | 'search' | 'url'>('text');
  readonly placeholder = input<string>('');
  readonly icon = input<IconName | null>(null);
  readonly suffix = input<string | null>(null);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly autofocus = input<boolean>(false);
  readonly step = input<string | null>(null);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly name = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  /** Overrides the errors read from the control (already translated or keys). */
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-input-${++uiInputSequence}`;
  readonly hintId = `${this.inputId}-hint`;
  readonly errorsId = `${this.inputId}-errors`;

  protected readonly value = signal('');
  protected readonly revealed = signal(false);
  private readonly formDisabled = signal(false);
  private readonly stateTick = signal(0);

  private readonly injector = inject(Injector);
  private ngControl: NgControl | null = null;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cd = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  private propagate: (value: string) => void = () => {};
  private touch: () => void = () => {};

  ngAfterViewInit(): void {
    this.ngControl = this.injector.get(NgControl, null);
    const control = this.ngControl?.control;
    if (control) {
      control.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.stateTick.update((tick) => tick + 1);
        this.cd.markForCheck();
      });
      // FormControlName wires its control after the host component's init hook.
    }
    this.stateTick.update((tick) => tick + 1);
    if (!this.autofocus()) return;
    (this.host.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }

  protected readonly isPassword = computed(() => this.type() === 'password');
  protected readonly effectiveType = computed(() =>
    this.isPassword() && this.revealed() ? 'text' : this.type(),
  );
  protected readonly hasIcon = computed(() => this.icon() !== null);
  protected readonly iconName = computed<string>(() => this.icon() ?? 'info');
  protected readonly hasTrailing = computed(() => this.isPassword() || this.suffix() !== null);
  protected readonly iconSize = computed<number>(() => (this.size() === 'sm' ? 14 : this.size() === 'lg' ? 20 : 16));

  protected text(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  protected readonly isDisabled = computed(() => {
    this.stateTick();
    return this.disabled() || this.formDisabled() || (this.ngControl?.control?.disabled ?? false);
  });

  /** Errors only appear once the user has interacted with the field. */
  protected readonly showErrors = computed(() => {
    this.stateTick();
    const control = this.ngControl?.control;
    if (!control) return false;
    return control.touched || control.dirty;
  });

  protected readonly errorEntries = computed<FieldErrorEntry[]>(() => {
    this.stateTick();
    const override = this.errors();
    if (override && override.length > 0) {
      return override.map((key) => ({ key, params: {} }));
    }
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

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.propagate(next);
  }

  protected onBlur(): void {
    this.touch();
    this.stateTick.update((tick) => tick + 1);
  }

  protected toggleReveal(): void {
    this.revealed.update((open) => !open);
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
