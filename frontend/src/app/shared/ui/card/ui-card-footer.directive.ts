import { Directive } from '@angular/core';

/**
 * Marks the element that becomes the card footer. The card only renders its
 * footer chrome when this content child is present, so a card without actions
 * never shows an empty band.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[uiCardFooter]',
  standalone: true,
  host: { class: 'ui-card-footer' },
})
export class UiCardFooterDirective {}
