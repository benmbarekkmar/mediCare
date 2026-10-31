import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ToastService, type Toast, type ToastKind } from '../../../core/toast/toast.service';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { IconName } from '../icon/icons';

/**
 * The visible half of `ToastService`: a bottom-end stack that renders the
 * service signal. Mounted once in `app.component.html`, it owns no state.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-toast-host',
  standalone: true,
  imports: [UiIconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-toast-stack" role="status" aria-live="polite" (keydown)="onKeydown($event)">
      @for (toast of visible(); track toast.id) {
        <div class="ui-toast" [attr.data-kind]="toast.kind" tabindex="0">
          <span class="ui-toast__icon">
            <ui-icon [name]="icons()[toast.kind]" size="18" />
          </span>

          <div class="ui-toast__text">
            <p class="ui-toast__title">{{ toast.title }}</p>
            @if (toast.message) {
              <p class="ui-toast__message">{{ toast.message }}</p>
            }
          </div>

          <button
            type="button"
            class="ui-toast__dismiss"
            [attr.aria-label]="'ui.toast.dismiss' | translate"
            (click)="dismiss(toast.id)"
          >
            <ui-icon name="x" size="16" />
          </button>

          @if (toast.kind === 'error') {
            <span
              class="ui-toast__progress"
              [style.animationDuration]="durationOf(toast)"
              aria-hidden="true"
            ></span>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .ui-toast-stack {
        position: fixed;
        inset-block-end: var(--sp-4);
        inset-inline-end: var(--sp-4);
        z-index: var(--z-toast);
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        width: min(calc(100vw - var(--sp-8)), 380px);
        /* the region is invisible until a toast lands, so it must not eat clicks */
        pointer-events: none;
      }
      .ui-toast {
        --toast-accent: var(--info-500);
        --toast-soft: var(--info-50);

        position: relative;
        overflow: hidden;
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        padding: var(--sp-3);
        pointer-events: auto;
        color: var(--text);
        background: var(--surface);
        border: 1px solid var(--border);
        border-inline-start: 3px solid var(--toast-accent);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-md);
        animation: ui-toast-in var(--duration) var(--ease);
      }
      .ui-toast[data-kind='success'] {
        --toast-accent: var(--success-500);
        --toast-soft: var(--success-50);
      }
      .ui-toast[data-kind='error'] {
        --toast-accent: var(--danger-500);
        --toast-soft: var(--danger-50);
      }
      .ui-toast[data-kind='warning'] {
        --toast-accent: var(--warning-500);
        --toast-soft: var(--warning-50);
      }
      .ui-toast__icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: var(--sp-5);
        height: var(--sp-5);
        color: var(--toast-accent);
        background: var(--toast-soft);
        border-radius: var(--radius-pill);
      }
      .ui-toast__text {
        flex: 1 1 auto;
        min-width: 0;
      }
      .ui-toast__title {
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: 650;
        color: var(--text);
      }
      .ui-toast__message {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-xs);
        color: var(--text-muted);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .ui-toast__dismiss {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: var(--sp-5);
        height: var(--sp-5);
        padding: 0;
        color: var(--text-subtle);
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
      .ui-toast__progress {
        position: absolute;
        inset-inline-start: 0;
        inset-block-end: 0;
        display: block;
        width: 100%;
        height: 2px;
        background: var(--toast-accent);
        transform-origin: left center;
        animation-name: ui-toast-countdown;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
        animation-iteration-count: 1;
      }
      @keyframes ui-toast-in {
        from {
          opacity: 0;
          transform: translateY(var(--sp-3));
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @keyframes ui-toast-countdown {
        from {
          transform: scaleX(1);
        }
        to {
          transform: scaleX(0);
        }
      }
    `,
  ],
})
export class UiToastHostComponent {
  /** The stack never grows past this many toasts; the newest always wins. */
  readonly maxVisible = input<number>(5);

  private readonly toastService = inject(ToastService);

  protected readonly visible = computed(() => {
    const all = this.toastService.toasts();
    const limit = Math.max(1, this.maxVisible());
    return all.length > limit ? all.slice(all.length - limit) : all;
  });

  protected readonly icons = computed<Record<ToastKind, IconName>>(() => ({
    success: 'circle-check',
    error: 'circle-x',
    warning: 'triangle-alert',
    info: 'info',
  }));

  protected durationOf(toast: Toast): string {
    return `${toast.ms > 0 ? toast.ms : 5000}ms`;
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }

  /** Enter drops the front toast, Escape clears the whole stack. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      for (const toast of this.visible()) this.toastService.dismiss(toast.id);
      return;
    }
    if (event.key !== 'Enter') return;
    const newest = this.visible().at(-1);
    if (!newest) return;
    event.preventDefault();
    this.toastService.dismiss(newest.id);
  }
}
