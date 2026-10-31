import { Directive, input, TemplateRef } from '@angular/core';

export interface UiCellContext<T = any> {
  $implicit: T;
  row: T;
  column: string;
}

/**
 * A projected cell template: `<ng-template uiCell="name" let-row="row" let-column="column">`.
 * The attribute value is the column `field` this template renders.
 */
@Directive({ selector: 'ng-template[uiCell]', standalone: true })
export class UiCellDirective {
  readonly uiCell = input('', { alias: 'uiCell' });
  readonly column = input('');

  constructor(readonly template: TemplateRef<UiCellContext<any>>) {}

  get field(): string {
    return this.uiCell() || this.column();
  }
}

/** The trailing per-row actions column: `<ng-template uiRowActions let-row="row">`. */
@Directive({ selector: 'ng-template[uiRowActions]', standalone: true })
export class UiRowActionsDirective {
  constructor(readonly template: TemplateRef<{ $implicit: unknown; row: unknown }>) {}
}
