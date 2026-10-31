import { Directive, TemplateRef, inject } from '@angular/core';

/**
 * Marks the chips/badges slot of `ui-page-header`, rendered under the title.
 * Accepted on an element or on an `<ng-template>`, exactly like `uiPageActions`.
 */
@Directive({ selector: '[uiPageMeta]', standalone: true })
export class UiPageMetaDirective {
  /** Present only when the directive sits on an `<ng-template>`. */
  readonly template: TemplateRef<unknown> | null = inject(TemplateRef, { optional: true });
}
