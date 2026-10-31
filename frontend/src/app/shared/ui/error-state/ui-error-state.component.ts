import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { IconName } from '../icon/icons';

/** Failure placeholder with a retry affordance. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-error-state',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="error" role="alert">
      <span class="error__icon"><ui-icon [name]="icon()" [size]="24" /></span>
      <p class="error__title">{{ title() }}</p>
      <p class="error__message">{{ message() }}</p>
      @if (hint()) {
        <p class="error__hint">{{ hint() }}</p>
      }
      <button type="button" class="error__retry" (click)="retry.emit()">
        <ui-icon name="refresh" [size]="15" /> {{ 'uipage.retry' | translate }}
      </button>
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .error {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-7) var(--sp-4);
        text-align: center;
      }
      .error__icon {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: var(--danger-50);
        color: var(--danger-500);
      }
      .error__title {
        margin: 0;
        color: var(--text);
        font-size: var(--fs-base);
        font-weight: 600;
      }
      .error__message,
      .error__hint {
        max-width: 52ch;
        margin: 0;
        color: var(--text-muted);
        font-size: var(--fs-sm);
        white-space: pre-line;
      }
      .error__retry {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        margin-top: var(--sp-3);
        padding: var(--sp-2) var(--sp-4);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 500;
        cursor: pointer;
      }
      .error__retry:hover {
        background: var(--bg-hover);
      }
    `,
  ],
})
export class UiErrorStateComponent {
  readonly title = input('');
  readonly message = input('');
  readonly hint = input<string | null>(null);
  readonly icon = input<IconName | string>('triangle-alert');
  readonly retry = output<void>();
}
