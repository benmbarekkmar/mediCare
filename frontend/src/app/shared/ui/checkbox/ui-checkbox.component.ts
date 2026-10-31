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
import { UiIconComponent } from '../icon/ui-icon.component';
import type { FieldErrorEntry } from '../input/ui-input.component';

let uiCheckboxSequence = 0;

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
 * Boolean control over a real `<input type="checkbox">`: the native element
 * stays focusable and Space toggles it, only the box is drawn.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-checkbox',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiCheckboxComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="check" [attr.for]="inputId">
        <span class="box">
          <input
            class="real"
            type="checkbox"
            [id]="inputId"
            [checked]="checked()"
            [attr.disabled]="isDisabled() ? '' : null"
            [attr.required]="required() ? '' : null"
            [attr.aria-required]="required() || null"
            [attr.aria-invalid]="hasErrors() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [attr.name]="name()"
            (change)="onToggle($event)"
            (blur)="onBlur()"
          />
          <span class="mark" aria-hidden="true"></span>
          <ui-icon class="tick" name="check" size="14" />
        </span>
        <span class="text">
          <span class="ui-label" [class.ui-label--required]="required()">{{ text(label()) }}</span>
          @if (hint() !== null) {
            <span class="ui-hint" [id]="hintId">{{ text(hint()) }}</span>
          }
        </span>
      </label>

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
      .check {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--sp-2);
        cursor: pointer;
      }
      .box {
        position: relative;
        display: inline-flex;
        flex: none;
        width: var(--sp-4);
        height: var(--sp-4);
        margin-block-start: var(--sp-1);
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
      .mark {
        display: block;
        width: 100%;
        height: 100%;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-input);
        background: var(--surface);
        transition:
          background var(--duration) var(--ease),
          border-color var(--duration) var(--ease),
          box-shadow var(--duration) var(--ease);
      }
      .tick {
        position: absolute;
        inset: 0;
        display: none;
        color: var(--text-inverse);
        pointer-events: none;
      }
      .real:checked + .mark {
        background: var(--primary);
        border-color: var(--primary);
      }
      .real:checked ~ .tick {
        display: inline-flex;
      }
      .real:hover + .mark {
        border-color: var(--primary);
      }
      .real:focus-visible + .mark {
        box-shadow: var(--focus-ring);
        border-color: var(--primary);
      }
      .real:disabled + .mark {
        background: var(--bg-sunken);
        border-color: var(--border);
      }
      .real[aria-invalid='true'] + .mark {
        border-color: var(--danger-500);
      }
      .text {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
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
export class UiCheckboxComponent implements OnInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly name = input<string | null>(null);
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-checkbox-${++uiCheckboxSequence}`;
  readonly hintId = `${this.inputId}-hint`;
  readonly errorsId = `${this.inputId}-errors`;

  protected readonly checked = signal(false);
  private readonly formDisabled = signal(false);
  private readonly stateTick = signal(0);

  private readonly injector = inject(Injector);
  private ngControl: NgControl | null = null;
  private readonly cd = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  private propagate: (value: boolean) => void = () => {};
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

  protected text(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

  protected readonly describedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.hint() !== null) ids.push(this.hintId);
    if (this.hasErrors()) ids.push(this.errorsId);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  protected onToggle(event: Event): void {
    const next = (event.target as HTMLInputElement).checked;
    this.checked.set(next);
    this.propagate(next);
  }

  protected onBlur(): void {
    this.touch();
    this.stateTick.update((tick) => tick + 1);
  }

  writeValue(raw: unknown): void {
    this.checked.set(raw === true || raw === 'true');
    this.cd.markForCheck();
  }

  registerOnChange(fn: (value: boolean) => void): void {
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
