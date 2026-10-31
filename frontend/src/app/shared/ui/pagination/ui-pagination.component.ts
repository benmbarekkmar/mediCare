import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';

type PageSlot = number | 'gap-start' | 'gap-end';

/**
 * The windowed page strip of every list: first / previous / numbered window /
 * next / last. It only tells the caller which page it wants — the server always
 * decides what is on it.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-pagination',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1) {
      <nav class="ui-pagination" [attr.aria-label]="'ui.pagination.label' | translate">
        <button
          type="button"
          class="ui-pagination__btn"
          [disabled]="isFirst()"
          [attr.aria-label]="'ui.pagination.first' | translate"
          (click)="goTo(1)"
        >
          <ui-icon name="arrow-left" [size]="16" />
        </button>
        <button
          type="button"
          class="ui-pagination__btn"
          [disabled]="isFirst()"
          [attr.aria-label]="'ui.pagination.previous' | translate"
          (click)="goTo(page() - 1)"
        >
          <ui-icon name="chevron-left" [size]="16" />
        </button>

        @for (slot of slots(); track $index) {
          @switch (slot) {
            @case ('gap-start') {
              <span class="ui-pagination__gap" aria-hidden="true">…</span>
            }
            @case ('gap-end') {
              <span class="ui-pagination__gap" aria-hidden="true">…</span>
            }
            @default {
              <button
                type="button"
                class="ui-pagination__btn ui-pagination__num"
                [attr.aria-label]="'ui.pagination.page' | translate: { page: slot }"
                [attr.aria-current]="slot === page() ? 'page' : null"
                (click)="goTo(slot)"
              >
                {{ slot }}
              </button>
            }
          }
        }

        <button
          type="button"
          class="ui-pagination__btn"
          [disabled]="isLast()"
          [attr.aria-label]="'ui.pagination.next' | translate"
          (click)="goTo(page() + 1)"
        >
          <ui-icon name="chevron-right" [size]="16" />
        </button>
        <button
          type="button"
          class="ui-pagination__btn"
          [disabled]="isLast()"
          [attr.aria-label]="'ui.pagination.last' | translate"
          (click)="goTo(totalPages())"
        >
          <ui-icon name="arrow-right" [size]="16" />
        </button>
      </nav>
      <span class="visually-hidden" aria-live="polite">
        {{ 'ui.table.page' | translate: { page: page(), total: totalPages() } }}
      </span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
      }
      .ui-pagination {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
      }
      .ui-pagination__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--sp-6);
        height: var(--sp-6);
        padding-inline: var(--sp-1);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-input);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: var(--fs-sm);
        cursor: pointer;
        transition:
          background var(--duration-fast) var(--ease),
          border-color var(--duration-fast) var(--ease),
          color var(--duration-fast) var(--ease);
      }
      .ui-pagination__btn:hover:not(:disabled) {
        border-color: var(--primary);
        color: var(--primary);
      }
      .ui-pagination__btn:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .ui-pagination__btn:disabled {
        color: var(--text-subtle);
        background: var(--bg-sunken);
        border-color: var(--border);
        cursor: not-allowed;
      }
      .ui-pagination__num[aria-current='page'] {
        background: var(--primary);
        border-color: var(--primary);
        color: var(--text-inverse);
        font-weight: 650;
      }
      .ui-pagination__gap {
        color: var(--text-subtle);
        padding-inline: var(--sp-1);
      }
    `,
  ],
})
export class UiPaginationComponent {
  readonly page = model(1);
  readonly pageSize = input(10);
  readonly total = input(0);
  readonly siblingCount = input(1);

  protected readonly totalPages = computed(() => {
    const size = this.pageSize() > 0 ? this.pageSize() : 1;
    return Math.max(1, Math.ceil(Math.max(0, this.total()) / size));
  });

  protected readonly isFirst = computed(() => this.clampedPage() <= 1);
  protected readonly isLast = computed(() => this.clampedPage() >= this.totalPages());

  private readonly clampedPage = computed(() => {
    const total = this.totalPages();
    const page = Number.isFinite(this.page()) ? this.page() : 1;
    return Math.min(Math.max(1, Math.trunc(page)), total);
  });

  protected readonly slots = computed<PageSlot[]>(() => {
    const total = this.totalPages();
    const current = this.clampedPage();
    const siblings = Math.max(0, Math.trunc(this.siblingCount()));
    const pageCount = siblings * 2 + 5;
    if (total <= pageCount) return range(1, total);

    const leftSibling = Math.max(current - siblings, 1);
    const rightSibling = Math.min(current + siblings, total);
    const showLeftGap = leftSibling > 2;
    const showRightGap = rightSibling < total - 1;

    if (!showLeftGap && showRightGap) {
      return [...range(1, siblings * 2 + 3), 'gap-end', total];
    }
    if (showLeftGap && !showRightGap) {
      return [1, 'gap-start', ...range(total - (siblings * 2 + 2), total)];
    }
    return [1, 'gap-start', ...range(leftSibling, rightSibling), 'gap-end', total];
  });

  protected goTo(slot: PageSlot): void {
    if (typeof slot !== 'number') return;
    const target = Math.min(Math.max(1, slot), this.totalPages());
    if (target === this.page()) return;
    this.page.set(target);
  }
}

const range = (start: number, end: number): number[] =>
  Array.from({ length: Math.max(0, end - start + 1) }, (_unused, index) => start + index);
