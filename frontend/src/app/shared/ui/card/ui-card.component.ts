import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  booleanAttribute,
  computed,
  contentChild,
  inject,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';
import { UiCardFooterDirective } from './ui-card-footer.directive';

/**
 * Explicit marker for the header action slot: the alternative to binding the
 * template through its `<ng-template #actions>` reference name.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'ng-template[uiCardActions]',
  standalone: true,
})
export class UiCardActionsDirective {
  readonly template = inject(TemplateRef);
}

export type UiCardPad = 'none' | 'md' | 'lg';

/**
 * The surface every screen is built from: a titled body with an optional icon,
 * a right-aligned action area and an optional footer band.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-card',
  standalone: true,
  imports: [NgTemplateOutlet, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ui-card--clickable]': 'clickable()',
    '[class.ui-card--elevated]': 'elevated()',
    '[attr.role]': 'clickable() ? "button" : null',
    '[attr.tabindex]': 'clickable() ? 0 : null',
    '(keydown)': 'onHostKeydown($event)',
  },
  template: `
    <header class="ui-card__head">
      <div class="ui-card__titles">
        @if (icon()) {
          <span class="ui-card__icon" aria-hidden="true">
            <ui-icon [name]="icon() ?? 'info'" [size]="18" />
          </span>
        }
        <div class="ui-card__text">
          @if (title()) {
            <h3 class="ui-card__title">{{ title() }}</h3>
          }
          @if (subtitle()) {
            <p class="ui-card__subtitle">{{ subtitle() }}</p>
          }
        </div>
      </div>
      @if (actions()) {
        <div class="ui-card__actions">
          <ng-container [ngTemplateOutlet]="actions()" />
        </div>
      }
    </header>

    <div class="ui-card__body" [attr.data-pad]="pad()">
      <ng-content />
    </div>

    @if (footer()) {
      <div class="ui-card__foot">
        <ng-content select="[uiCardFooter]" />
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-sm);
        color: var(--text);
        overflow: hidden;
      }
      :host(.ui-card--elevated) {
        box-shadow: var(--shadow-md);
      }
      :host(.ui-card--clickable) {
        cursor: pointer;
        transition:
          box-shadow var(--duration) var(--ease),
          border-color var(--duration) var(--ease),
          transform var(--duration) var(--ease);
      }
      :host(.ui-card--clickable):hover {
        border-color: var(--primary);
        box-shadow: var(--shadow-md);
      }
      :host(.ui-card--clickable:focus-visible) {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
        box-shadow: var(--focus-ring);
      }
      .ui-card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sp-3);
        padding: var(--sp-4) var(--sp-4) 0;
      }
      .ui-card__titles {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-3);
        flex: 1 1 auto;
        min-width: 0;
      }
      .ui-card__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--sp-6);
        height: var(--sp-6);
        flex: none;
        border-radius: var(--radius-input);
        background: var(--primary-soft);
        color: var(--primary);
      }
      .ui-card__text {
        flex: 1 1 auto;
        min-width: 0;
      }
      .ui-card__title {
        margin: 0;
        font-size: var(--fs-md);
        font-weight: 650;
        line-height: 1.3;
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .ui-card__subtitle {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        line-height: 1.5;
        overflow-wrap: anywhere;
        color: var(--text-muted);
      }
      .ui-card__actions {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex: none;
      }
      .ui-card__body[data-pad='md'] {
        padding: var(--sp-4);
      }
      .ui-card__body[data-pad='lg'] {
        padding: var(--sp-5);
      }
      .ui-card__body[data-pad='none'] {
        padding: 0;
      }
      .ui-card__foot {
        border-top: 1px solid var(--border);
        background: var(--surface-alt);
        padding: var(--sp-3) var(--sp-4);
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        flex-wrap: wrap;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      @media (max-width: 1024px) {
        .ui-card__head {
          padding: var(--sp-3) var(--sp-3) 0;
        }
        .ui-card__foot {
          padding: var(--sp-3);
        }
      }
    `,
  ],
})
export class UiCardComponent {
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly icon = input<IconName | null>(null);
  readonly elevated = input(false, { transform: booleanAttribute });
  readonly pad = input<UiCardPad>('md');
  readonly clickable = input(false, { transform: booleanAttribute });

  /** `<ng-template uiCardActions>`: the explicit form. */
  private readonly actionsMarked = contentChild(UiCardActionsDirective);
  /** `<ng-template #actions>`: the form the contract shows. */
  private readonly actionsNamed = contentChild<TemplateRef<unknown>>('actions');
  protected readonly footer = contentChild(UiCardFooterDirective);

  protected readonly actions = computed<TemplateRef<unknown> | null>(() => {
    const marked = this.actionsMarked();
    if (marked) return marked.template;
    return this.actionsNamed() ?? null;
  });

  private readonly element = inject(ElementRef<HTMLElement>);

  /** A clickable card is a `role="button"` surface, so Enter/Space must work. */
  onHostKeydown(event: KeyboardEvent): void {
    if (!this.clickable() || event.target !== this.element.nativeElement) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.element.nativeElement.click();
  }
}
