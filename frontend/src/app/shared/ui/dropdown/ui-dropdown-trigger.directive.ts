import { Directive } from '@angular/core';

/**
 * Marks the projected trigger of `ui-dropdown`. The bare `trigger` attribute is
 * accepted as well, which is the spelling the component contract documents.
 * The directive carries no behaviour: it only lets the dropdown tell whether a
 * trigger was projected, so the icon fallback can stay out of the way.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[uiDropdownTrigger], [trigger]',
  standalone: true,
})
export class UiDropdownTriggerDirective {}
