import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, HostListener, NgZone, OnDestroy, inject, input } from '@angular/core';

const TOOLTIP_CLASS = 'ui-tooltip';
const STYLE_ID = 'ui-tooltip-styles';

let nextTooltipSequence = 0;

/**
 * Tooltip styles are injected once per document: a directive owns no scoped
 * stylesheet, and the floating element lives on `<body>` outside any view.
 * Everything is token-driven, so both themes stay readable — the panel inverts
 * `--text` against `--surface`.
 */
const TOOLTIP_CSS = `
  .${TOOLTIP_CLASS} {
    position: fixed;
    z-index: var(--z-popover);
    margin: 0;
    padding: var(--sp-1) var(--sp-2);
    font-family: var(--font-sans);
    font-size: var(--fs-xs);
    line-height: 1.4;
    white-space: nowrap;
    color: var(--surface);
    background: var(--text);
    border-radius: var(--radius-input);
    box-shadow: var(--shadow-sm);
    pointer-events: none;
    animation: ui-tooltip-fade var(--duration-fast) var(--ease);
  }
  @keyframes ui-tooltip-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

/** Attaches the shared stylesheet, the way the CDK overlay container does. */
function ensureTooltipStyles(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TOOLTIP_CSS;
  document.head.append(style);
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

/**
 * `[uiTooltip]` — the hint for icon-only and technical controls. Touch pointers
 * never get one; Escape, blur, pointer-out and scroll all dismiss it, and every
 * listener it adds is unwound on close and on destroy.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[uiTooltip]',
  standalone: true,
})
export class UiTooltipDirective implements OnDestroy {
  readonly uiTooltip = input.required<string>();
  readonly position = input<'top' | 'bottom' | 'left' | 'right'>('top');
  /** Hover delay in milliseconds; keyboard focus does not wait. */
  readonly delay = input<number>(250);

  private readonly hostElement = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly tooltipId = `ui-tooltip-${(nextTooltipSequence += 1)}`;

  private panel: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private detachDismissing: (() => void) | null = null;

  /** A touch screen has no hover to explain, so it gets no tooltip either. */
  private get hoverCapable(): boolean {
    const view = this.document.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return true;
    return !view.matchMedia('(hover: none)').matches && !view.matchMedia('(pointer: coarse)').matches;
  }

  @HostListener('mouseenter')
  protected onPointerEnter(): void {
    if (this.hoverCapable) this.scheduleShow(this.delay());
  }

  @HostListener('mouseleave')
  protected onPointerLeave(): void {
    this.hide();
  }

  @HostListener('focus')
  protected onFocus(): void {
    if (!this.hoverCapable || !this.isFocusVisible()) return;
    this.scheduleShow(0);
  }

  @HostListener('blur')
  protected onBlur(): void {
    this.hide();
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.hide();
  }

  ngOnDestroy(): void {
    this.hide();
  }

  /** Public so a caller can reveal a hint programmatically (help icons). */
  showNow(): void {
    this.scheduleShow(0);
  }

  dismiss(): void {
    this.hide();
  }

  private scheduleShow(wait: number): void {
    this.cancelTimer();
    if (this.panel) return;
    const text = this.uiTooltip();
    if (!text) return;
    if (wait <= 0) {
      this.show(text);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.show(text);
    }, wait);
  }

  private show(text: string): void {
    if (this.panel) return;
    const view = this.document.defaultView;
    if (!view) return;
    ensureTooltipStyles(this.document);

    const panel = this.document.createElement('div');
    panel.className = TOOLTIP_CLASS;
    panel.setAttribute('role', 'tooltip');
    panel.setAttribute('id', this.tooltipId);
    panel.textContent = text;
    this.document.body.append(panel);
    this.panel = panel;
    this.hostElement.setAttribute('aria-describedby', this.tooltipId);
    this.place(panel);

    // The hint must not outlive the place it points at.
    this.detachDismissing = this.zone.runOutsideAngular(() => {
      const dismiss = (): void => this.hide();
      view.addEventListener('scroll', dismiss, { capture: true, passive: true });
      view.addEventListener('resize', dismiss, { passive: true });
      return () => {
        view.removeEventListener('scroll', dismiss, { capture: true });
        view.removeEventListener('resize', dismiss);
      };
    });
  }

  private hide(): void {
    this.cancelTimer();
    this.detachDismissing?.();
    this.detachDismissing = null;
    const panel = this.panel;
    this.panel = null;
    panel?.remove();
    if (this.hostElement.getAttribute('aria-describedby') === this.tooltipId) {
      this.hostElement.removeAttribute('aria-describedby');
    }
  }

  /** Places the panel on the wanted side, flipping when the viewport objects. */
  private place(panel: HTMLElement): void {
    const bounds = this.hostElement.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const edge = this.spacing();
    const viewportWidth = this.document.documentElement.clientWidth;
    const viewportHeight = this.document.documentElement.clientHeight;
    let side = this.position();

    if (side === 'top' && bounds.top - size.height - edge < 0) side = 'bottom';
    else if (side === 'bottom' && bounds.bottom + size.height + edge > viewportHeight) side = 'top';
    else if (side === 'left' && bounds.left - size.width - edge < 0) side = 'right';
    else if (side === 'right' && bounds.right + size.width + edge > viewportWidth) side = 'left';

    const vertical =
      side === 'top'
        ? bounds.top - size.height - edge
        : side === 'bottom'
          ? bounds.bottom + edge
          : bounds.top + bounds.height / 2 - size.height / 2;
    const horizontal =
      side === 'left'
        ? bounds.left - size.width - edge
        : side === 'right'
          ? bounds.right + edge
          : bounds.left + bounds.width / 2 - size.width / 2;

    panel.style.top = `${clamp(vertical, edge, Math.max(edge, viewportHeight - size.height - edge))}px`;
    panel.style.left = `${clamp(horizontal, edge, Math.max(edge, viewportWidth - size.width - edge))}px`;
  }

  /** The offset comes from the spacing scale, never from a literal. */
  private spacing(): number {
    const view = this.document.defaultView;
    if (!view) return 0;
    const raw = view.getComputedStyle(this.document.documentElement).getPropertyValue('--sp-2');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private isFocusVisible(): boolean {
    try {
      return this.hostElement.matches(':focus-visible');
    } catch {
      // engines without :focus-visible keep hover as the only trigger.
      return false;
    }
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
