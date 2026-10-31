import { Directive, TemplateRef, inject } from '@angular/core';

/**
 * Marks the buttons slot of `ui-page-header`.
 *
 * Works on a plain element (`<div uiPageActions><ui-button…/></div>`, projected
 * as-is) and on a template (`<ng-template uiPageActions>…</ng-template>`,
 * rendered inside the header's action area), so a page never has to nest the
 * header's own layout to place a primary action.
 */
@Directive({ selector: '[uiPageActions]', standalone: true })
export class UiPageActionsDirective {
  /** Present only when the directive sits on an `<ng-template>`. */
  readonly template: TemplateRef<unknown> | null = inject(TemplateRef, { optional: true });
}
