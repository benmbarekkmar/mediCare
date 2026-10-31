import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';

/**
 * The only clickable the design system knows. It wraps a real `<button>` (or an
 * `<a>` when `href` is set) so keyboard, form submission and screen readers all
 * behave like native elements, and every visual state comes from the tokens.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-button',
  standalone: true,
  imports: [TranslateModule, NgTemplateOutlet, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ui-button--full-width]': 'fullWidth()' },
  template: `
    <ng-template #labelContent><ng-content /></ng-template>
    @if (href() === null) {
      <button
        class="ui-button"
        [class.ui-button--primary]="variant() === 'primary'"
        [class.ui-button--secondary]="variant() === 'secondary'"
        [class.ui-button--outline]="variant() === 'outline'"
        [class.ui-button--ghost]="variant() === 'ghost'"
        [class.ui-button--danger]="variant() === 'danger'"
        [class.ui-button--sm]="size() === 'sm'"
        [class.ui-button--md]="size() === 'md'"
        [class.ui-button--lg]="size() === 'lg'"
        [class.ui-button--full]="fullWidth()"
        [type]="type()"
        [disabled]="isDisabled()"
        [attr.aria-busy]="loading() || null"
      >
        <span class="ui-button__inner">
          @if (loading()) {
            <ui-icon class="ui-button__spinner" name="loader" [size]="iconSize()" />
            <span class="visually-hidden" role="status">{{ 'ui.button.busy' | translate }}</span>
          } @else if (hasLeadingIcon()) {
            <ui-icon [name]="leadingIcon()" [size]="iconSize()" />
          }
          <span class="ui-button__label"><ng-container [ngTemplateOutlet]="labelContent" /></span>
          @if (hasTrailingIcon()) {
            <ui-icon [name]="trailingIcon()" [size]="iconSize()" />
          }
        </span>
      </button>
    } @else {
      <a
        class="ui-button"
        [class.ui-button--primary]="variant() === 'primary'"
        [class.ui-button--secondary]="variant() === 'secondary'"
        [class.ui-button--outline]="variant() === 'outline'"
        [class.ui-button--ghost]="variant() === 'ghost'"
        [class.ui-button--danger]="variant() === 'danger'"
        [class.ui-button--sm]="size() === 'sm'"
        [class.ui-button--md]="size() === 'md'"
        [class.ui-button--lg]="size() === 'lg'"
        [class.ui-button--full]="fullWidth()"
        role="button"
        [href]="href()"
        [attr.tabindex]="isDisabled() ? -1 : 0"
        [attr.aria-disabled]="isDisabled() || null"
      >
        <span class="ui-button__inner">
          @if (loading()) {
            <ui-icon class="ui-button__spinner" name="loader" [size]="iconSize()" />
            <span class="visually-hidden" role="status">{{ 'ui.button.busy' | translate }}</span>
          } @else if (hasLeadingIcon()) {
            <ui-icon [name]="leadingIcon()" [size]="iconSize()" />
          }
          <span class="ui-button__label"><ng-container [ngTemplateOutlet]="labelContent" /></span>
          @if (hasTrailingIcon()) {
            <ui-icon [name]="trailingIcon()" [size]="iconSize()" />
          }
        </span>
      </a>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        max-width: 100%;
      }
      :host(.ui-button--full-width) {
        display: flex;
        width: 100%;
      }
      .ui-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sp-2);
        font-family: inherit;
        font-weight: 600;
        line-height: 1.2;
        border: 1px solid transparent;
        border-radius: var(--radius-input);
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
        transition:
          background var(--duration) var(--ease),
          border-color var(--duration) var(--ease),
          color var(--duration) var(--ease),
          box-shadow var(--duration) var(--ease);
      }
      .ui-button--sm {
        padding: var(--sp-1) var(--sp-2);
        font-size: var(--fs-xs);
      }
      .ui-button--md {
        padding: var(--sp-2) var(--sp-3);
        font-size: var(--fs-sm);
      }
      .ui-button--lg {
        padding: var(--sp-2) var(--sp-4);
        font-size: var(--fs-base);
      }
      .ui-button--full {
        width: 100%;
      }
      .ui-button__inner {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sp-2);
        min-width: 0;
      }
      .ui-button__label {
        display: inline-block;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* variants: every colour is a token so both themes stay correct */
      .ui-button--primary {
        background: var(--primary);
        color: var(--text-inverse);
      }
      .ui-button--primary:hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--primary-hover);
      }
      .ui-button--secondary {
        background: var(--secondary);
        color: var(--text-inverse);
      }
      .ui-button--secondary:hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--primary-hover);
      }
      .ui-button--outline {
        background: var(--surface);
        color: var(--primary);
        border-color: var(--border-strong);
      }
      .ui-button--outline:hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--primary-soft);
        border-color: var(--primary);
      }
      .ui-button--ghost {
        background: transparent;
        color: var(--text-muted);
      }
      .ui-button--ghost:hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--bg-hover);
        color: var(--text);
      }
      .ui-button--danger {
        background: var(--danger-500);
        color: var(--text-inverse);
      }
      .ui-button--danger:hover:not(:disabled):not([aria-disabled='true']) {
        background: var(--danger-700);
      }

      .ui-button:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .ui-button:disabled,
      .ui-button[aria-disabled='true'] {
        background: var(--bg-sunken);
        color: var(--text-subtle);
        border-color: var(--border);
        cursor: not-allowed;
      }

      .ui-button__spinner {
        animation: uiButtonSpin 800ms linear infinite;
      }
      @keyframes uiButtonSpin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class UiButtonComponent {
  readonly variant = input<'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'>('primary');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly icon = input<IconName | null>(null);
  readonly iconRight = input<IconName | null>(null);
  readonly loading = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly type = input<'button' | 'submit'>('button');
  readonly fullWidth = input<boolean>(false);
  readonly href = input<string | null>(null);

  protected readonly isDisabled = computed(() => this.loading() || this.disabled());

  protected readonly iconSize = computed<number>(() => {
    const size = this.size();
    if (size === 'sm') return 14;
    return size === 'lg' ? 18 : 16;
  });

  /** The fallback names are never rendered: `has…Icon()` guards them first. */
  protected readonly hasLeadingIcon = computed(() => !this.loading() && this.icon() !== null);
  protected readonly leadingIcon = computed<string>(() => this.icon() ?? 'loader');
  protected readonly hasTrailingIcon = computed(() => !this.loading() && this.iconRight() !== null);
  protected readonly trailingIcon = computed<string>(() => this.iconRight() ?? 'loader');
}
