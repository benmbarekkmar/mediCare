import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { IconName } from '../icon/icons';

export type UiAlertKind = 'info' | 'success' | 'warning' | 'danger';

/** What each banner means, drawn the same way on every screen. */
const ALERT_ICON: Record<UiAlertKind, IconName> = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

/**
 * A static inline banner: form results, import summaries, permission notices.
 * Not a toast — it stays where the page put it until it is dismissed.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-alert',
  standalone: true,
  imports: [UiIconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isDismissed()) {
      <div class="ui-alert" [attr.data-kind]="kind()" [attr.role]="kind() === 'danger' ? 'alert' : 'status'">
        <span class="ui-alert__icon">
          <ui-icon [name]="icon() ?? iconName()" size="18" />
        </span>

        <div class="ui-alert__content">
          @if (title()) {
            <p class="ui-alert__title">{{ title() }}</p>
          }
          <div class="ui-alert__body">
            <ng-content />
          </div>
        </div>

        @if (dismissible()) {
          <button
            type="button"
            class="ui-alert__dismiss"
            [attr.aria-label]="'ui.alert.dismiss' | translate"
            (click)="hide()"
          >
            <ui-icon name="x" size="16" />
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ui-alert {
        --alert-accent: var(--info-500);
        --alert-soft: var(--info-50);
        --alert-border: var(--info-100);

        display: flex;
        align-items: flex-start;
        gap: var(--sp-3);
        padding: var(--sp-3) var(--sp-4);
        color: var(--text);
        background: var(--alert-soft);
        border: 1px solid var(--alert-border);
        border-inline-start: 3px solid var(--alert-accent);
        border-radius: var(--radius-card);
      }
      .ui-alert[data-kind='success'] {
        --alert-accent: var(--success-500);
        --alert-soft: var(--success-50);
        --alert-border: var(--success-100);
      }
      .ui-alert[data-kind='warning'] {
        --alert-accent: var(--warning-500);
        --alert-soft: var(--warning-50);
        --alert-border: var(--warning-100);
      }
      .ui-alert[data-kind='danger'] {
        --alert-accent: var(--danger-500);
        --alert-soft: var(--danger-50);
        --alert-border: var(--danger-100);
      }
      .ui-alert__icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        color: var(--alert-accent);
      }
      .ui-alert__content {
        flex: 1 1 auto;
        min-width: 0;
      }
      .ui-alert__title {
        margin: 0 0 var(--sp-1);
        font-size: var(--fs-sm);
        font-weight: 650;
      }
      .ui-alert__body {
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .ui-alert__dismiss {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: var(--sp-5);
        height: var(--sp-5);
        padding: 0;
        color: var(--text-muted);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--radius-input);
        cursor: pointer;
        transition:
          color var(--duration-fast) var(--ease),
          background var(--duration-fast) var(--ease);

        &:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
      }
    `,
  ],
})
export class UiAlertComponent {
  readonly kind = input<UiAlertKind>('info');
  readonly title = input<string | null>(null);
  readonly dismissible = input<boolean>(false);
  /** Overrides the glyph the kind implies. */
  readonly icon = input<IconName | null>(null);

  readonly dismissed = output<void>();

  protected readonly iconName = computed<IconName>(() => ALERT_ICON[this.kind()]);
  protected readonly isDismissed = signal(false);

  protected hide(): void {
    if (this.isDismissed()) return;
    this.isDismissed.set(true);
    this.dismissed.emit();
  }

  /** Lets a caller re-show an alert it dismissed before. */
  reset(): void {
    this.isDismissed.set(false);
  }

  private readonly signal = /* signal is imported below; keep the field order readable */ false;
}
