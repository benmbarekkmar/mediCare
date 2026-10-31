import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { statusClass } from '../../../core/util/format';

export type BadgeKind = 'status' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/**
 * A small semantic label. Appointment and test statuses use `kind="status"`
 * plus `[status]`, so every screen colours "Confirmed" the same way through the
 * global status vocabulary.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ui-badge" [class]="classes()">
      @if (showDot()) {
        <span class="ui-badge__dot" aria-hidden="true"></span>
      }
      @if (label()) {
        <span class="ui-badge__text">{{ label() }}</span>
      } @else {
        <span class="ui-badge__text">
          <ng-content />
        </span>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        max-width: 100%;
      }
      .ui-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        max-width: 100%;
        padding: 2px var(--sp-2);
        border-radius: var(--radius-pill);
        border: 1px solid var(--border);
        font-size: var(--fs-xs);
        font-weight: 600;
        line-height: 1.6;
        white-space: nowrap;
        background: var(--surface-alt);
        color: var(--text-muted);
      }
      .ui-badge__text {
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .ui-badge__dot {
        width: 6px;
        height: 6px;
        flex: none;
        border-radius: var(--radius-pill);
        background: var(--badge-color, var(--status-color, var(--text-subtle)));
      }
      .ui-badge--info {
        --badge-color: var(--info-500);
        background: var(--info-50);
        border-color: var(--info-100);
        color: var(--info-700);
      }
      .ui-badge--success {
        --badge-color: var(--success-500);
        background: var(--success-50);
        border-color: var(--success-100);
        color: var(--success-700);
      }
      .ui-badge--warning {
        --badge-color: var(--warning-500);
        background: var(--warning-50);
        border-color: var(--warning-100);
        color: var(--warning-700);
      }
      .ui-badge--danger {
        --badge-color: var(--danger-500);
        background: var(--danger-50);
        border-color: var(--danger-100);
        color: var(--danger-700);
      }
      .ui-badge--neutral {
        --badge-color: var(--text-subtle);
      }
      .ui-badge--status {
        --badge-color: var(--status-color, var(--text-subtle));
        background: var(--surface-alt);
        border-color: var(--border);
        color: var(--text);
      }
    `,
  ],
})
export class UiBadgeComponent {
  readonly kind = input<BadgeKind>('neutral');
  readonly label = input<string | null>(null);
  /** The raw status string of the record: only read when `kind` is `status`. */
  readonly status = input<string | null>(null);
  readonly dot = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => {
    const kind = this.kind();
    const parts = ['ui-badge', `ui-badge--${kind}`];
    if (kind === 'status') parts.push(statusClass(this.status()));
    return parts.join(' ');
  });

  protected readonly showDot = computed(() => this.dot() || this.kind() === 'status');
}
