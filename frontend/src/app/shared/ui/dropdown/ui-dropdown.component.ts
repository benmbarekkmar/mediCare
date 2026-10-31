import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  afterNextRender,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
  viewChild,
  Injector,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';
import type { IconName } from '../icon/icons';
import { UiDropdownTriggerDirective } from './ui-dropdown-trigger.directive';

/** One row of a dropdown menu; separators carry no label. */
export interface DropdownItem {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

/**
 * The action menu of the design system: rows, separators and danger rows, fully
 * keyboard driven, closing on outside pointer input and on scroll.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-dropdown',
  standalone: true,
  imports: [UiIconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-dropdown" #root [attr.data-align]="align()">
      <button
        #triggerButton
        type="button"
        class="ui-dropdown__trigger"
        [class.ui-dropdown__trigger--open]="isOpen()"
        [disabled]="disabled()"
        aria-haspopup="menu"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-label]="projectedTrigger() ? null : (triggerLabel() ?? ('uioverlay.dropdown.trigger' | translate))"
        (click)="toggle()"
        (keydown)="onTriggerKeydown($event)"
      >
        <span class="ui-dropdown__trigger-content">
          <ng-content select="[uiDropdownTrigger], [trigger]"></ng-content>
        </span>
        @if (!projectedTrigger()) {
          <ui-icon class="ui-dropdown__trigger-icon" [name]="triggerIcon() ?? 'ellipsis'" size="16" />
        }
        <ui-icon class="ui-dropdown__caret" name="chevron-down" size="14" />
      </button>

      @if (isOpen()) {
        <div
          class="ui-dropdown__menu"
          role="menu"
          [attr.aria-label]="menuLabel() ?? ('uioverlay.dropdown.menu' | translate)"
          (keydown)="onMenuKeydown($event)"
        >
          @for (item of items(); track $index) {
            @if (item.separator) {
              <span class="ui-dropdown__separator" role="separator"></span>
            } @else {
              <button
                type="button"
                role="menuitem"
                class="ui-dropdown__item"
                [class.ui-dropdown__item--danger]="item.danger === true"
                [disabled]="item.disabled === true"
                (click)="select(item)"
              >
                @if (item.icon) {
                  <ui-icon class="ui-dropdown__item-icon" [name]="item.icon" size="16" />
                }
                <span class="ui-dropdown__item-label">{{ item.label }}</span>
              </button>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        position: relative;
        vertical-align: middle;
      }
      .ui-dropdown {
        position: relative;
        display: inline-flex;
      }
      .ui-dropdown__trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        min-height: 34px;
        padding: 0 var(--sp-3);
        font: inherit;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-input);
        cursor: pointer;
        transition:
          color var(--duration-fast) var(--ease),
          background var(--duration-fast) var(--ease),
          border-color var(--duration-fast) var(--ease);

        &:hover:not(:disabled) {
          color: var(--text);
          border-color: var(--primary);
        }
        &:disabled {
          color: var(--text-subtle);
          background: var(--bg-sunken);
          cursor: not-allowed;
        }
      }
      .ui-dropdown__trigger--open,
      .ui-dropdown__trigger[aria-expanded='true'] {
        color: var(--text);
        border-color: var(--primary);
        box-shadow: var(--focus-ring);
      }
      .ui-dropdown__trigger-content {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        min-width: 0;
      }
      .ui-dropdown__caret {
        color: var(--text-subtle);
        transition: transform var(--duration-fast) var(--ease);
      }
      .ui-dropdown__trigger--open .ui-dropdown__caret {
        transform: rotate(180deg);
      }
      .ui-dropdown__menu {
        position: absolute;
        inset-block-start: calc(100% + var(--sp-1));
        inset-inline-start: 0;
        z-index: var(--z-popover);
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        min-width: 180px;
        max-height: min(60vh, 320px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: var(--sp-2);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-md);
        animation: ui-dropdown-open var(--duration-fast) var(--ease);
      }
      .ui-dropdown[data-align='end'] .ui-dropdown__menu {
        inset-inline-start: auto;
        inset-inline-end: 0;
      }
      .ui-dropdown__item {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        width: 100%;
        padding: var(--sp-2);
        font: inherit;
        font-size: var(--fs-sm);
        text-align: start;
        color: var(--text);
        background: transparent;
        border: 0;
        border-radius: var(--radius-input);
        cursor: pointer;
        transition:
          background var(--duration-fast) var(--ease),
          color var(--duration-fast) var(--ease);

        &:hover:not(:disabled),
        &:focus-visible {
          background: var(--bg-hover);
          outline: none;
        }
        &:focus-visible {
          box-shadow: var(--focus-ring);
        }
        &:disabled {
          color: var(--text-subtle);
          cursor: not-allowed;
        }
      }
      .ui-dropdown__item--danger {
        color: var(--danger-500);
      }
      .ui-dropdown__item--danger:hover:not(:disabled) {
        background: var(--danger-50);
      }
      .ui-dropdown__item-icon {
        flex: none;
        color: inherit;
      }
      .ui-dropdown__item-label {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .ui-dropdown__separator {
        display: block;
        height: 1px;
        margin: var(--sp-1) 0;
        background: var(--border);
      }
      @keyframes ui-dropdown-open {
        from {
          opacity: 0;
          transform: translateY(var(--sp-1));
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
    `,
  ],
})
export class UiDropdownComponent implements OnDestroy {
  readonly items = input.required<DropdownItem[]>();
  readonly align = input<'start' | 'end'>('start');
  /** Convenience for icon-only menus; the projected trigger wins over it. */
  readonly triggerIcon = input<IconName | null>(null);
  readonly triggerLabel = input<string | null>(null);
  readonly menuLabel = input<string | null>(null);
  readonly disabled = input<boolean>(false);

  readonly itemSelect = output<DropdownItem>();

  /** True while the menu is rendered; drives `aria-expanded`. */
  protected readonly isOpen = computed(() => this.openState());
  private readonly openState = signal(false);

  protected readonly projectedTrigger = contentChild(UiDropdownTriggerDirective);
  protected readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly triggerButton = viewChild.required<ElementRef<HTMLButtonElement>>('triggerButton');
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private detachDismiss: (() => void) | null = null;

  /** Menu rows only: the order matches the rendered `.ui-dropdown__item` nodes. */
  private get rows(): DropdownItem[] {
    return this.items().filter((item) => !item.separator);
  }

  private get nodes(): HTMLButtonElement[] {
    const root = this.root()?.nativeElement;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.ui-dropdown__item'));
  }

  toggle(): void {
    if (this.disabled()) return;
    if (this.openState()) this.closeMenu({ focusTrigger: true });
    else this.openMenu();
  }

  close(): void {
    if (this.openState()) this.closeMenu({ focusTrigger: false });
  }

  select(item: DropdownItem): void {
    if (item.disabled === true || item.separator) return;
    this.itemSelect.emit(item);
    this.closeMenu({ focusTrigger: true });
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.openState()) this.openMenu();
      this.focusRow(event.key === 'ArrowDown' ? 0 : -1);
      return;
    }
    if (event.key === 'Escape' && this.openState()) {
      event.preventDefault();
      this.closeMenu({ focusTrigger: true });
    }
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const active = this.document.activeElement;
    const nodes = this.nodes;
    const current = nodes.indexOf(active as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusRow(current < 0 ? 0 : current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusRow(current < 0 ? -1 : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusRow(-1);
        break;
      case 'Escape':
        event.preventDefault();
        this.closeMenu({ focusTrigger: true });
        break;
      case 'Tab':
        this.closeMenu({ focusTrigger: false });
        break;
      default:
        if (this.isTypographyKey(event)) this.typeAhead(event.key, current);
    }
  }

  /** `-1` means the last row; disabled rows are skipped in both directions. */
  private focusRow(target: number): void {
    const rows = this.rows;
    if (rows.length === 0) return;
    const wanted = target < 0 ? rows.length - 1 : target;
    for (let offset = 0; offset < rows.length; offset += 1) {
      const index = (wanted + offset) % rows.length;
      if (!rows[index].disabled) {
        this.nodes[index]?.focus({ preventScroll: true });
        return;
      }
    }
  }

  /** First-letter search, from the highlighted row onwards. */
  private typeAhead(key: string, from: number): void {
    const rows = this.rows;
    if (rows.length === 0) return;
    const needle = key.toLowerCase();
    const start = from < 0 ? 0 : from + 1;
    for (let step = 0; step < rows.length; step += 1) {
      const index = (start + step) % rows.length;
      const row = rows[index];
      if (row.disabled !== true && row.label.trim().toLowerCase().startsWith(needle)) {
        this.nodes[index]?.focus({ preventScroll: true });
        return;
      }
    }
  }

  private isTypographyKey(event: KeyboardEvent): boolean {
    return !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && event.key.trim() !== '';
  }

  private openMenu(): void {
    this.openState.set(true);
    this.attachDismissal();
    afterNextRender(
      () => {
        this.focusRow(0);
      },
      { injector: this.injector },
    );
  }

  private closeMenu(options: { focusTrigger: boolean }): void {
    if (!this.openState()) return;
    this.openState.set(false);
    this.detachDismissal();
    if (!options.focusTrigger) return;
    afterNextRender(
      () => {
        this.triggerButton().nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Outside pointer input, scrolling and a resize all dismiss the menu. */
  private attachDismissal(): void {
    this.detachDismissal();
    this.detachDismiss = this.zone.runOutsideAngular(() => {
      const root = this.root()?.nativeElement ?? null;
      const onPointerDown = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (root?.contains(target)) return;
        this.zone.run(() => this.closeMenu({ focusTrigger: false }));
      };
      const onViewportChange = (): void => this.zone.run(() => this.closeMenu({ focusTrigger: false }));

      this.document.addEventListener('pointerdown', onPointerDown, true);
      const view = this.document.defaultView;
      view?.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
      view?.addEventListener('resize', onViewportChange, { passive: true });

      return () => {
        this.document.removeEventListener('pointerdown', onPointerDown, true);
        view?.removeEventListener('scroll', onViewportChange, { capture: true });
        view?.removeEventListener('resize', onViewportChange);
      };
    });
  }

  private detachDismissal(): void {
    this.detachDismiss?.();
    this.detachDismiss = null;
  }

  ngOnDestroy(): void {
    this.detachDismissal();
  }
}
