import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { type Lang, SUPPORTED_LANGS } from '../../../core/i18n/i18n';
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';
import { UiSkeletonComponent } from '../skeleton/ui-skeleton.component';

/**
 * The KPI tile of the dashboards: one big number, what it means, where it is
 * going and, while the request is in flight, a skeleton of the same shape so
 * the grid never jumps.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-stat-card',
  standalone: true,
  imports: [TranslateModule, UiIconComponent, UiSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ui-stat--gradient]': 'gradient()',
  },
  template: `
    @if (loading()) {
      <div class="ui-stat ui-stat--loading">
        <ui-skeleton [width]="'2.5rem'" [height]="'2.5rem'" [circle]="true" />
        <ui-skeleton [width]="'45%'" [height]="'1.75rem'" [announce]="false" />
        <ui-skeleton [width]="'70%'" height="0.85rem" [announce]="false" />
      </div>
    } @else {
      <div class="ui-stat">
        <div class="ui-stat__top">
          <span class="ui-stat__icon" aria-hidden="true">
            <ui-icon [name]="icon()" [size]="18" />
          </span>
          @if (trend() !== null) {
            <span class="ui-stat__trend" [attr.data-direction]="direction()">
              <ui-icon [name]="trendIcon()" [size]="14" />
              <span class="ui-stat__trend-value">{{ trendValue() }}</span>
              <span class="visually-hidden">{{ 'uidata.stat.trend' | translate: { value: trendValue() } }}</span>
            </span>
          }
        </div>
        <p class="ui-stat__value">{{ displayValue() }}</p>
        <p class="ui-stat__label">{{ label() }}</p>
        @if (hint()) {
          <p class="ui-stat__hint">{{ hint() }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-sm);
        color: var(--text);
      }
      :host(.ui-stat--gradient) {
        background: var(--gradient-kpi);
        border-color: transparent;
        --stat-text: var(--text-inverse);
        --stat-muted: var(--text-inverse);
        --stat-icon-bg: var(--scrim);
        --stat-icon-text: var(--text-inverse);
        --stat-trend-bg: var(--scrim);
      }
      .ui-stat {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding: var(--sp-4);
        min-width: 0;
      }
      .ui-stat--loading {
        gap: var(--sp-3);
      }
      .ui-stat__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
      }
      .ui-stat__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--sp-6);
        height: var(--sp-6);
        border-radius: var(--radius-input);
        background: var(--stat-icon-bg, var(--primary-soft));
        color: var(--stat-icon-text, var(--primary));
      }
      .ui-stat__value {
        margin: 0;
        font-size: var(--fs-2xl);
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.02em;
        color: var(--stat-text, var(--text));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ui-stat__label {
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--stat-muted, var(--text-muted));
      }
      .ui-stat__hint {
        margin: 0;
        font-size: var(--fs-xs);
        color: var(--stat-muted, var(--text-subtle));
      }
      .ui-stat__trend {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        padding: 2px var(--sp-2);
        border-radius: var(--radius-pill);
        font-size: var(--fs-xs);
        font-weight: 650;
        background: var(--stat-trend-bg, var(--surface-alt));
        color: var(--trend-color, var(--text-muted));
      }
      .ui-stat__trend[data-direction='up'] {
        --trend-color: var(--success-700);
      }
      .ui-stat__trend[data-direction='down'] {
        --trend-color: var(--danger-700);
      }
      .ui-stat__trend[data-direction='flat'] {
        --trend-color: var(--text-muted);
      }
      :host(.ui-stat--gradient) .ui-stat__trend[data-direction='up'],
      :host(.ui-stat--gradient) .ui-stat__trend[data-direction='down'],
      :host(.ui-stat--gradient) .ui-stat__trend[data-direction='flat'] {
        --trend-color: var(--text-inverse);
      }
      @media (max-width: 1024px) {
        .ui-stat {
          padding: var(--sp-3);
        }
        .ui-stat__value {
          font-size: var(--fs-xl);
        }
      }
    `,
  ],
})
export class UiStatCardComponent {
  readonly value = input<string | number>('');
  readonly label = input('');
  readonly icon = input<IconName>('chart');
  /** Percentage points against the previous period. */
  readonly trend = input<number | null>(null);
  readonly hint = input<string | null>(null);
  readonly loading = input(false, { transform: booleanAttribute });
  readonly gradient = input(false, { transform: booleanAttribute });

  private readonly lang = computed<Lang>(() => {
    const htmlLang = document.documentElement.lang;
    return (SUPPORTED_LANGS as readonly string[]).includes(htmlLang) ? (htmlLang as Lang) : 'en';
  });

  protected readonly displayValue = computed(() => {
    const raw = this.value();
    return typeof raw === 'number' ? new Intl.NumberFormat(this.lang() === 'fr' ? 'fr-FR' : 'en-GB').format(raw) : raw;
  });

  protected readonly direction = computed(() => {
    const trend = this.trend();
    if (trend === null) return 'flat';
    if (trend > 0) return 'up';
    return trend < 0 ? 'down' : 'flat';
  });

  protected readonly trendIcon = computed(() => {
    const direction = this.direction();
    return direction === 'up' ? 'arrow-up' : direction === 'down' ? 'arrow-down' : 'arrow-up-down';
  });

  protected readonly trendValue = computed(() => {
    const trend = this.trend();
    if (trend === null) return '';
    const sign = trend > 0 ? '+' : '';
    return `${sign}${trend.toFixed(1)} %`;
  });
}
