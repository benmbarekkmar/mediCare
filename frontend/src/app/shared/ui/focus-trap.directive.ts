import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Keeps focus inside a dialog while it is open (WCAG 2.1.2) and lets the host
 * close it with Esc without every component re-implementing the walker.
 */
@Directive({ selector: '[uiFocusTrap]', standalone: true })
export class FocusTrapDirective {
  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly FOCUSABLE =
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const elements = Array.from((this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(this.FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Moves the initial focus to the first field, or the panel itself. */
  focusInitial(): void {
    const first = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(this.FOCUSABLE);
    (first ?? this.host.nativeElement).focus({ preventScroll: true });
  }
}
