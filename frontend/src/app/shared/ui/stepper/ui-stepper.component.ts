import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import { UiButtonComponent } from '../button/ui-button.component';

/** One step of the wizard: an id, a visible label and an optional hint. */
export interface UiStep {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

/**
 * The horizontal progress header of a guided flow, per CONTRACT.md:
 * `steps`, two-way `index`, `linear` (true), an optional `completed` flag array
 * and `next` / `back` / `finish` outputs. It renders only the header and the
 * footer navigation; the body stays the caller's
 * `@if (index() === n)` block, so the wizard keeps ownership of every field.
 *
 * The footer buttons only *ask* to move (`next` / `back` / `finish`); the
 * component never advances `index` on its own, because the caller has to
 * validate the current step first. Clicking a step in the header does move
 * directly, but only backwards (or anywhere once the flow is non-linear), so a
 * linear wizard can never be skipped forward by mouse.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-stepper',
  standalone: true,
  imports: [TranslateModule, UiIconComponent, UiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="ui-stepper" [attr.aria-label]="'patient.stepper.aria' | translate">
      <ol class="ui-stepper__list">
        @for (step of steps(); track step.id; let i = $index) {
          <li
            class="ui-stepper__item"
            [class.ui-stepper__item--current]="i === index()"
            [class.ui-stepper__item--done]="isDone(i)"
            [class.ui-stepper__item--todo]="!isDone(i) && i !== index()"
          >
            <button
              type="button"
              class="ui-stepper__step"
              [disabled]="!canEnter(i)"
              [attr.aria-current]="i === index() ? 'step' : null"
              (click)="enter(i)"
            >
              <span class="ui-stepper__marker" aria-hidden="true">
                @if (isDone(i)) {
                  <ui-icon name="check" [size]="16" />
                } @else {
                  <span class="ui-stepper__num">{{ i + 1 }}</span>
                }
              </span>
              <span class="ui-stepper__text">
                <span class="ui-stepper__label">{{ step.label }}</span>
                @if (step.hint) {
                  <span class="ui-stepper__hint">{{ step.hint }}</span>
                }
              </span>
            </button>
          </li>
        }
      </ol>

      <p class="ui-stepper__progress" role="status">
        {{ 'patient.stepper.progress' | translate: { current: index() + 1, total: steps().length } }}
      </p>
    </nav>

    <div class="ui-stepper__body">
      <ng-content />
    </div>

    <div class="ui-stepper__footer">
      <ui-button variant="outline" icon="arrow-left" [disabled]="index() === 0" (click)="back.emit()">
        {{ 'patient.stepper.back' | translate }}
      </ui-button>

      <span class="ui-stepper__spacer" aria-hidden="true"></span>

      @if (!isLast()) {
        <ui-button variant="primary" icon-right="arrow-right" (click)="next.emit()">
          {{ 'patient.stepper.next' | translate }}
        </ui-button>
      } @else {
        <ui-button variant="primary" icon="check" (click)="finish.emit()">
          {{ 'patient.stepper.finish' | translate }}
        </ui-button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        padding: var(--sp-5);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
      }
      .ui-stepper {
        min-width: 0;
      }
      .ui-stepper__list {
        display: flex;
        align-items: stretch;
        gap: var(--sp-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .ui-stepper__item {
        position: relative;
        flex: 1 1 0;
        min-width: 0;
      }
      .ui-stepper__item:not(:last-child)::after {
        content: '';
        position: absolute;
        z-index: 0;
        inset-block-start: 19px;
        inset-inline-start: calc(50% + 16px);
        inset-inline-end: calc(-50% + 16px - var(--sp-1));
        block-size: 2px;
        background: var(--border);
      }
      .ui-stepper__item--done::after {
        background: var(--primary);
      }
      .ui-stepper__step {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-1);
        inline-size: 100%;
        min-width: 0;
        padding: var(--sp-1);
        border: 0;
        border-radius: var(--radius);
        background: transparent;
        color: var(--text-muted);
        font: inherit;
        text-align: center;
        cursor: pointer;
        transition: color var(--duration) var(--ease), background var(--duration) var(--ease);
      }
      .ui-stepper__step:disabled {
        cursor: default;
      }
      .ui-stepper__step:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text);
      }
      .ui-stepper__step:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .ui-stepper__marker {
        display: grid;
        place-items: center;
        flex: none;
        inline-size: 32px;
        block-size: 32px;
        border-radius: var(--radius-pill);
        border: 2px solid var(--border-strong);
        background: var(--surface);
        color: var(--text-muted);
        font-weight: 600;
      }
      .ui-stepper__num {
        font-size: var(--fs-sm);
      }
      .ui-stepper__item--current .ui-stepper__marker {
        border-color: var(--primary);
        background: var(--primary);
        color: var(--text-inverse);
      }
      .ui-stepper__item--done .ui-stepper__marker {
        border-color: var(--success-500);
        background: var(--success-50);
        color: var(--success-700);
      }
      .ui-stepper__text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .ui-stepper__label {
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .ui-stepper__item--current .ui-stepper__label {
        color: var(--text);
      }
      .ui-stepper__hint {
        font-size: var(--fs-xs);
        color: var(--text-subtle);
        overflow-wrap: anywhere;
      }
      .ui-stepper__item--current .ui-stepper__hint {
        color: var(--text-muted);
      }
      .ui-stepper__progress {
        width: max-content;
        margin: var(--sp-3) auto 0;
        padding: 2px var(--sp-3);
        border-radius: var(--radius-pill);
        background: var(--surface-alt);
        text-align: center;
        font-size: var(--fs-xs);
        color: var(--text-muted);
      }
      .ui-stepper__body {
        margin-block-start: var(--sp-5);
        min-width: 0;
      }
      .ui-stepper__footer {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        margin-block-start: var(--sp-5);
        padding-block-start: var(--sp-4);
        border-block-start: 1px solid var(--border);
      }
      .ui-stepper__spacer {
        flex: 1 1 auto;
      }
      @media (max-width: 640px) {
        :host {
          padding: var(--sp-4);
        }
        .ui-stepper__label {
          font-size: var(--fs-xs);
        }
        .ui-stepper__body {
          margin-block-start: var(--sp-4);
        }
        .ui-stepper__footer {
          margin-block-start: var(--sp-4);
          padding-block-start: var(--sp-3);
        }
      }
    `,
  ],
})
export class UiStepperComponent {
  readonly steps = input.required<readonly UiStep[]>();
  /** Two-way: the zero-based index of the active step. */
  readonly index = model<number>(0);
  readonly linear = input<boolean>(true);
  /** Optional explicit completion flags; a step before the cursor also reads done. */
  readonly completed = input<readonly boolean[] | null>(null);

  readonly next = output<void>();
  readonly back = output<void>();
  readonly finish = output<void>();

  protected readonly isLast = computed(() => this.index() >= this.steps().length - 1);

  protected isDone(position: number): boolean {
    const flags = this.completed();
    if (flags && position < flags.length && flags[position] === true) return true;
    return position < this.index();
  }

  /** A step may be entered by clicking: always backwards, forward only if non-linear. */
  protected canEnter(position: number): boolean {
    if (position === this.index()) return false;
    if (position < this.index()) return true;
    return !this.linear();
  }

  protected enter(position: number): void {
    if (!this.canEnter(position)) return;
    this.index.set(position);
  }
}
