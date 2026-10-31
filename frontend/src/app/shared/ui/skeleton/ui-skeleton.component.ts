import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * The loading placeholder of the design system: one block, a circle or a
 * multi-line text block. It is invisible to assistive technology, which instead
 * gets one polite "loading" message (suppress it with `[announce]="false"` when
 * a screen renders a whole grid of skeletons and announces once).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-skeleton',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lineCount() > 1) {
      <span class="ui-skeleton__lines" aria-hidden="true">
        @for (line of lineBlocks(); track line.index) {
          <span
            class="ui-skeleton"
            [class.ui-skeleton--circle]="circle()"
            [style.width]="line.width"
            [style.height]="line.height"
            [style.border-radius]="radiusValue()"
          ></span>
        }
      </span>
    } @else {
      <span
        class="ui-skeleton"
        [class.ui-skeleton--circle]="circle()"
        [style.width]="sizeValue(width())"
        [style.height]="sizeValue(height())"
        [style.border-radius]="radiusValue()"
        aria-hidden="true"
      ></span>
    }
    @if (announce()) {
      <span class="visually-hidden" aria-live="polite">{{ 'common.loading' | translate }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        min-width: 0;
      }
      .ui-skeleton__lines {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .ui-skeleton {
        display: block;
        width: 100%;
        height: var(--sp-3);
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .ui-skeleton--circle {
        border-radius: var(--radius-pill);
      }
    `,
  ],
})
export class UiSkeletonComponent {
  readonly width = input<string | number>('100%');
  readonly height = input<string | number>('1rem');
  readonly radius = input<string | null>(null);
  readonly lines = input<number | null>(null);
  readonly circle = input(false, { transform: booleanAttribute });
  readonly announce = input(true, { transform: booleanAttribute });

  protected readonly lineCount = computed(() => this.lines() ?? 1);

  /** The last line of a text block is shorter so it reads like real copy. */
  protected readonly lineBlocks = computed(() => {
    const count = Math.max(1, this.lineCount());
    const height = this.sizeValue(this.height());
    return Array.from({ length: count }, (_unused, index) => ({
      index,
      height,
      width: index === count - 1 && count > 1 ? '70%' : this.sizeValue(this.width()),
    }));
  });

  protected readonly radiusValue = computed(() => (this.circle() ? 'var(--radius-pill)' : this.radius()));

  protected readonly sizeValue = (value: string | number): string =>
    typeof value === 'number' ? `${value}px` : value;
}
