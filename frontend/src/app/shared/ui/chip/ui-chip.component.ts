import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';

/**
 * A removable pill: the active filters of the filter bar and the entities the
 * assistant extracted from a question both collapse into these.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-chip',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ui-chip">
      @if (icon()) {
        <ui-icon class="ui-chip__icon" [name]="icon() ?? 'tag'" [size]="14" />
      }
      <span class="ui-chip__label truncate">{{ label() }}</span>
      @if (count() !== null) {
        <span class="ui-chip__count">{{ count() }}</span>
      }
      @if (removable()) {
        <button
          type="button"
          class="ui-chip__remove"
          [attr.aria-label]="'ui.combobox.remove' | translate: { label: label() }"
          (click)="removed.emit()"
        >
          <ui-icon name="x" [size]="14" />
        </button>
      } @else {
        <ng-content />
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        max-width: 100%;
      }
      .ui-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        max-width: 100%;
        padding-block: 2px;
        padding-inline: var(--sp-2) 2px;
        border-radius: var(--radius-pill);
        border: 1px solid var(--border-strong);
        background: var(--surface);
        color: var(--text);
        font-size: var(--fs-xs);
        font-weight: 600;
      }
      .ui-chip__icon {
        color: var(--primary);
      }
      .ui-chip__label {
        min-width: 0;
      }
      .ui-chip__count {
        color: var(--text-subtle);
        font-weight: 500;
      }
      .ui-chip__remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: var(--sp-5);
        height: var(--sp-5);
        padding: 0;
        border: 0;
        border-radius: var(--radius-pill);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        transition:
          background var(--duration-fast) var(--ease),
          color var(--duration-fast) var(--ease);
      }
      .ui-chip__remove:hover {
        background: var(--danger-50);
        color: var(--danger-700);
      }
      .ui-chip__remove:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
    `,
  ],
})
export class UiChipComponent {
  readonly label = input('');
  readonly icon = input<IconName | null>(null);
  readonly removable = input(false, { transform: booleanAttribute });
  /** Optional trailing number, used by the entity lists. */
  readonly count = input<number | null>(null);
  readonly removed = output<void>();
}
