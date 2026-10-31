import { NgTemplateOutlet } from '@angular/common';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  model,
  viewChild,
  Injector,
  type TemplateRef,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import { FocusTrapDirective } from '../focus-trap.directive';

/** Class put on `<body>` while an overlay is open, so the page cannot scroll. */
const SCROLL_LOCK_CLASS = 'ui-overlay-scroll-lock';

let nextModalSequence = 0;

/**
 * The dialog shell of the product: inline rendering (no portal), a `--scrim`
 * backdrop, the shared focus trap and a body scroll lock that always unwinds.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-modal',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, UiIconComponent, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="ui-modal__backdrop" (click)="backdropClick()"></div>

      <div
        class="ui-modal"
        [attr.data-size]="size()"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="descriptionId()"
        (keydown)="panelKeydown($event)"
        uiFocusTrap
      >
        <header class="ui-modal__header">
          <div class="ui-modal__heading">
            <h2 class="ui-modal__title" [attr.id]="titleId">{{ title() }}</h2>
            @if (subtitle()) {
              <p class="ui-modal__subtitle" [attr.id]="descriptionId()">{{ subtitle() }}</p>
            }
          </div>
          @if (dismissible()) {
            <button
              type="button"
              class="ui-modal__close"
              [disabled]="busy()"
              [attr.aria-label]="'ui.modal.close' | translate"
              (click)="close()"
            >
              <ui-icon name="x" size="18" />
            </button>
          }
        </header>

        <div class="ui-modal__body">
          <ng-content />
        </div>

        @if (footerTemplate()) {
          <div class="ui-modal__footer">
            <ng-template [ngTemplateOutlet]="footerTemplate() ?? null"></ng-template>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .ui-modal__backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-modal);
        background: var(--scrim);
        animation: ui-modal-backdrop var(--duration) var(--ease);
      }
      .ui-modal {
        --dialog-width: 560px;

        position: fixed;
        inset-block-start: 50%;
        inset-inline-start: 50%;
        translate: -50% -50%;
        z-index: var(--z-modal);
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        width: min(100% - var(--sp-4), var(--dialog-width));
        max-height: min(85vh, 100% - var(--sp-5));
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-lg);
        animation: ui-modal-enter var(--duration) var(--ease);

        &:focus {
          outline: none;
        }
      }
      .ui-modal[data-size='sm'] {
        --dialog-width: 420px;
      }
      .ui-modal[data-size='lg'] {
        --dialog-width: 720px;
      }
      .ui-modal[data-size='xl'] {
        --dialog-width: 960px;
      }
      .ui-modal__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sp-3);
        padding: var(--sp-4) var(--sp-4) var(--sp-3);
        border-bottom: 1px solid var(--border);
      }
      .ui-modal__heading {
        min-width: 0;
      }
      .ui-modal__title {
        margin: 0;
        font-size: var(--fs-lg);
        line-height: 1.3;
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .ui-modal__subtitle {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .ui-modal__close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
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
          background var(--duration-fast) var(--ease),
          border-color var(--duration-fast) var(--ease);

        &:hover:not(:disabled) {
          color: var(--text);
          background: var(--bg-hover);
          border-color: var(--border);
        }
        &:disabled {
          color: var(--text-subtle);
          cursor: not-allowed;
        }
      }
      .ui-modal__body {
        padding: var(--sp-4);
        overflow-y: auto;
        overscroll-behavior: contain;
        color: var(--text);
        font-size: var(--fs-base);
      }
      .ui-modal__footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--sp-2);
        padding: var(--sp-3) var(--sp-4) var(--sp-4);
        border-top: 1px solid var(--border);
        background: var(--surface-alt);
        border-end-start-radius: var(--radius-card);
        border-end-end-radius: var(--radius-card);
      }
      @keyframes ui-modal-backdrop {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes ui-modal-enter {
        from {
          opacity: 0;
          transform: translateY(var(--sp-3)) scale(0.98);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
    `,
  ],
})
export class UiModalComponent {
  /** Two-way: `[open]` in, `(openChange)` out. */
  readonly open = model<boolean>(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  /** Blocks Escape and backdrop clicks while a request is in flight. */
  readonly busy = input<boolean>(false);
  readonly dismissible = input<boolean>(true);

  protected readonly titleId = `ui-modal-title-${(nextModalSequence += 1)}`;
  protected readonly descriptionId = computed(() => (this.subtitle() ? `${this.titleId}-desc` : null));

  /** The consumer's `<ng-template #footer>` — a content child, not a view child. */
  protected readonly footerTemplate = contentChild<TemplateRef<unknown>>('footer');
  private readonly focusTrap = viewChild(FocusTrapDirective);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private previouslyFocused: HTMLElement | null = null;
  private scrollLock: { overflow: string; paddingInlineEnd: string } | null = null;

  constructor() {
    // One reactive owner of the overlay side effects: it runs on every `open`
    // flip, so a consumer closing the dialog from its own state unwinds too.
    effect(
      () => {
        if (this.open()) {
          const active = this.document.activeElement;
          this.previouslyFocused = active instanceof HTMLElement ? active : null;
          this.lockScroll();
          afterNextRender(
            () => {
              this.focusTrap()?.focusInitial();
            },
            { injector: this.injector },
          );
        } else {
          this.unlockScroll();
          this.restoreFocus();
        }
      },
      { injector: this.injector },
    );
  }

  /** Removes the scroll lock even when the dialog is destroyed while open. */
  ngOnDestroy(): void {
    this.unlockScroll();
    this.restoreFocus();
  }

  close(): void {
    this.requestClose();
  }

  /** Backdrop click honours `busy` and `dismissible` exactly like Escape. */
  backdropClick(): void {
    this.requestClose();
  }

  protected panelKeydown(event: KeyboardEvent): void {
    this.focusTrap()?.onKeydown(event);
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.requestClose();
  }

  /** Closing is a state change; the effect above unwinds scroll and focus. */
  private requestClose(): void {
    if (this.busy() || !this.dismissible() || !this.open()) return;
    this.open.set(false);
  }

  /**
   * Each overlay remembers the body styles it found, so a dialog stacked on
   * another one restores the lock instead of removing it.
   */
  private lockScroll(): void {
    if (this.scrollLock) return;
    const body = this.document.body;
    if (!body) return;
    const gap = Math.max(0, body.offsetWidth - body.clientWidth);
    this.scrollLock = { overflow: body.style.overflow, paddingInlineEnd: body.style.paddingInlineEnd };
    body.classList.add(SCROLL_LOCK_CLASS);
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingInlineEnd = `calc(${body.style.paddingInlineEnd || '0px'} + ${gap}px)`;
  }

  private unlockScroll(): void {
    const saved = this.scrollLock;
    if (!saved) return;
    this.scrollLock = null;
    const body = this.document.body;
    if (!body) return;
    body.classList.remove(SCROLL_LOCK_CLASS);
    body.style.overflow = saved.overflow;
    body.style.paddingInlineEnd = saved.paddingInlineEnd;
  }

  private restoreFocus(): void {
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (!target || !target.isConnected) return;
    target.focus({ preventScroll: true });
  }
}
