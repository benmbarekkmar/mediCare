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

/** Same body lock as `ui-modal`, so a drawer and a dialog behave alike. */
const SCROLL_LOCK_CLASS = 'ui-overlay-scroll-lock';

let nextDrawerSequence = 0;

/**
 * The off-canvas panel: the mobile sidebar and the record side panel. Same
 * contract as `ui-modal`, plus `side` and `width`.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-drawer',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, UiIconComponent, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="ui-drawer__backdrop" (click)="backdropClick()"></div>

      <div
        class="ui-drawer"
        [attr.data-side]="side()"
        [style.width]="width()"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="descriptionId()"
        (keydown)="panelKeydown($event)"
        uiFocusTrap
      >
        <header class="ui-drawer__header">
          <div class="ui-drawer__heading">
            <h2 class="ui-drawer__title" [attr.id]="titleId">{{ title() }}</h2>
            @if (subtitle()) {
              <p class="ui-drawer__subtitle" [attr.id]="descriptionId()">{{ subtitle() }}</p>
            }
          </div>
          @if (dismissible()) {
            <button
              type="button"
              class="ui-drawer__close"
              [disabled]="busy()"
              [attr.aria-label]="'ui.drawer.close' | translate"
              (click)="close()"
            >
              <ui-icon name="x" size="18" />
            </button>
          }
        </header>

        <div class="ui-drawer__body">
          <ng-content />
        </div>

        @if (footerTemplate()) {
          <div class="ui-drawer__footer">
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
      .ui-drawer__backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-drawer);
        background: var(--scrim);
        animation: ui-drawer-backdrop var(--duration) var(--ease);
      }
      .ui-drawer {
        position: fixed;
        inset-block: 0;
        z-index: var(--z-drawer);
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        width: 420px;
        max-width: 100%;
        max-height: 100dvh;
        background: var(--surface);
        box-shadow: var(--shadow-lg);

        &:focus {
          outline: none;
        }
      }
      .ui-drawer[data-side='end'] {
        inset-inline-end: 0;
        border-inline-start: 1px solid var(--border);
        animation: ui-drawer-from-end var(--duration) var(--ease);
      }
      .ui-drawer[data-side='start'] {
        inset-inline-start: 0;
        border-inline-end: 1px solid var(--border);
        animation: ui-drawer-from-start var(--duration) var(--ease);
      }
      .ui-drawer__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sp-3);
        padding: var(--sp-4) var(--sp-4) var(--sp-3);
        border-bottom: 1px solid var(--border);
      }
      .ui-drawer__heading {
        min-width: 0;
      }
      .ui-drawer__title {
        margin: 0;
        font-size: var(--fs-lg);
        line-height: 1.3;
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .ui-drawer__subtitle {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .ui-drawer__close {
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
      .ui-drawer__body {
        flex: 1 1 auto;
        padding: var(--sp-4);
        overflow-y: auto;
        overscroll-behavior: contain;
        color: var(--text);
        font-size: var(--fs-base);
      }
      .ui-drawer__footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--sp-2);
        padding: var(--sp-3) var(--sp-4) var(--sp-4);
        border-top: 1px solid var(--border);
        background: var(--surface-alt);
      }
      @keyframes ui-drawer-backdrop {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes ui-drawer-from-end {
        from {
          transform: translateX(var(--sp-8));
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
      @keyframes ui-drawer-from-start {
        from {
          transform: translateX(calc(-1 * var(--sp-8)));
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
    `,
  ],
})
export class UiDrawerComponent {
  /** Two-way: `[open]` in, `(openChange)` out. */
  readonly open = model<boolean>(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly side = input<'start' | 'end'>('end');
  /** Any CSS width; the panel never grows past the viewport. */
  readonly width = input<string>('420px');
  readonly busy = input<boolean>(false);
  readonly dismissible = input<boolean>(true);

  protected readonly titleId = `ui-drawer-title-${(nextDrawerSequence += 1)}`;
  protected readonly descriptionId = computed(() => (this.subtitle() ? `${this.titleId}-desc` : null));
  protected readonly footerTemplate = contentChild<TemplateRef<unknown>>('footer');

  private readonly focusTrap = viewChild(FocusTrapDirective);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private previouslyFocused: HTMLElement | null = null;
  private scrollLock: { overflow: string; paddingInlineEnd: string } | null = null;

  constructor() {
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

  ngOnDestroy(): void {
    this.unlockScroll();
    this.restoreFocus();
  }

  close(): void {
    this.requestClose();
  }

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

  private requestClose(): void {
    if (this.busy() || !this.dismissible() || !this.open()) return;
    this.open.set(false);
  }

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
