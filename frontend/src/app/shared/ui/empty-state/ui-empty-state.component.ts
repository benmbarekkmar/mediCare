import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { IconName } from '../icon/icons';

/** Neutral, in-card empty placeholder: the list has no rows yet or none match. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-empty-state',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty" [class.empty--compact]="compact()" role="status">
      <span class="empty__icon"><ui-icon [name]="icon()" [size]="compact() ? 20 : 26" /></span>
      <p class="empty__title">{{ title() }}</p>
      @if (hint()) {
        <p class="empty__hint">{{ hint() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-8) var(--sp-4);
        text-align: center;
      }
      .empty--compact {
        gap: var(--sp-1);
        padding: var(--sp-5) var(--sp-3);
      }
      .empty__icon {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        margin-bottom: var(--sp-1);
        border-radius: 50%;
        background: var(--bg-sunken);
        color: var(--text-subtle);
      }
      .empty--compact .empty__icon {
        width: 36px;
        height: 36px;
        margin-bottom: 0;
      }
      .empty__title {
        margin: 0;
        color: var(--text);
        font-size: var(--fs-base);
        font-weight: 600;
      }
      .empty__hint {
        max-width: 46ch;
        margin: 0;
        color: var(--text-muted);
        font-size: var(--fs-sm);
      }
    `,
  ],
})
export class UiEmptyStateComponent {
  readonly icon = input<IconName | string>('inbox');
  readonly title = input('');
  readonly hint = input<string | null>(null);
  readonly compact = input(false, { transform: booleanAttribute });
}
