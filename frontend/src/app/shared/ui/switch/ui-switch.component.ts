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

let uiSwitchSequence = 0;

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
 * Boolean toggle drawn as a sliding track. It stays an
 * `<input type="checkbox" role="switch">`, so Space toggles it and assistive
 * technology announces the state; only the visual is ours.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-switch',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiSwitchComponent), multi: true }],
  template: `
    <div class="ui-field">
      <label class="switch" [attr.for]="inputId">
        <span class="track">
          <input
            class="real"
            type="checkbox"
            role="switch"
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
          <span class="knob" aria-hidden="true"></span>
        </span>
        <span class="text">
          <span class="ui-label" [class.ui-label--required]="required()">{{ text(label()) }}</span>
          <span class="state">{{ text(stateText()) }}</span>
        </span>
      </label>

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
      .switch {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        cursor: pointer;
      }
      .track {
        position: relative;
        display: inline-flex;
        flex: none;
        width: calc(var(--sp-6) + var(--sp-2));
        height: var(--sp-4);
        border-radius: var(--radius-pill);
        background: var(--bg-sunken);
        border: 1px solid var(--border-strong);
        transition:
          background var(--duration) var(--ease),
          border-color var(--duration) var(--ease),
          box-shadow var(--duration) var(--ease);
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
      .knob {
        position: absolute;
        inset-block-start: var(--sp-1);
        inset-inline-start: var(--sp-1);
        width: var(--sp-3);
        height: var(--sp-3);
        border-radius: var(--radius-pill);
        background: var(--text-muted);
        transition:
          transform var(--duration) var(--ease),
          background var(--duration) var(--ease);
      }
      .real:checked + .knob {
        transform: translateX(var(--sp-4));
        background: var(--text-inverse);
      }
      .track:has(.real:focus-visible) {
        box-shadow: var(--focus-ring);
      }
      .track:has(.real:checked) {
        background: var(--primary);
        border-color: var(--primary);
      }
      .track:has(.real:hover) {
        border-color: var(--primary);
      }
      .track:has(.real:disabled) {
        background: var(--border);
        border-color: var(--border);
      }
      .track:has(.real[aria-invalid='true']) {
        border-color: var(--danger-500);
      }
      .text {
        display: inline-flex;
        align-items: baseline;
        gap: var(--sp-2);
        min-width: 0;
      }
      .state {
        font-size: var(--fs-xs);
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
export class UiSwitchComponent implements OnInit, ControlValueAccessor {
  private readonly translate = inject(TranslateService);
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly onLabel = input<string | null>(null);
  readonly offLabel = input<string | null>(null);
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly name = input<string | null>(null);
  readonly errors = input<readonly string[] | null>(null);

  readonly inputId = `ui-switch-${++uiSwitchSequence}`;
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

  protected readonly describedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.hint() !== null) ids.push(this.hintId);
    if (this.hasErrors()) ids.push(this.errorsId);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  /** The caller's wording wins, otherwise the two catalogue keys are translated. */
  protected readonly stateText = computed<string>(() => {
    if (this.checked()) return this.onLabel() ?? 'uiforms.switch.on';
    return this.offLabel() ?? 'uiforms.switch.off';
  });

  protected text(value: string | null | undefined): string {
    return translateOrText(this.translate, value);
  }

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
