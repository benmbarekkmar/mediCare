import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { IconName } from '../icon/icons';

/**
 * The compact icon-only control used in table rows, toolbars and card corners.
 * `label` is mandatory for accessibility and becomes the tooltip and aria-label.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-icon-button',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    class="icon-btn"
    [class.icon-btn--danger]="danger()"
    [disabled]="disabled()"
    [attr.title]="label()"
    [attr.aria-label]="label()"
    (click)="clicked.emit()"
  >
    <ui-icon [name]="icon()" [size]="size()" />
  </button>`,
  styles: [
    `
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: 1px solid transparent;
        border-radius: var(--radius-input);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
      }
      .icon-btn:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text);
      }
      .icon-btn:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
      .icon-btn--danger:hover:not(:disabled) {
        background: var(--danger-50);
        color: var(--danger-700);
      }
      .icon-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
    `,
  ],
})
export class UiIconButtonComponent {
  readonly icon = input.required<IconName | string>();
  readonly label = input('');
  readonly size = input(16);
  readonly danger = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly clicked = output<void>();
}
