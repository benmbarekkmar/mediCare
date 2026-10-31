import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';

let nextTabsInstance = 0;

/** The keys that move focus inside a tablist, and how far they move it. */
const TAB_KEYS: ReadonlyMap<string, number | 'first' | 'last'> = new Map<string, number | 'first' | 'last'>([
  ['ArrowLeft', -1],
  ['ArrowRight', 1],
  ['Home', 'first'],
  ['End', 'last'],
]);

export interface UiTab {
  id: string;
  label: string;
  icon?: IconName | null;
  badge?: number | null;
}

/**
 * The section switcher of the record pages: one tablist with a roving tabindex
 * and an underline that animates between sections, while the panel content
 * itself stays in the caller's template.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-tabs',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ui-tabs__bar"
      role="tablist"
      [attr.aria-label]="'ui.tabs.label' | translate"
      (keydown)="onKeydown($event)"
    >
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          class="ui-tab"
          role="tab"
          [id]="tabId(tab.id)"
          [attr.aria-selected]="tab.id === current()"
          [attr.tabindex]="tab.id === current() ? 0 : -1"
          [attr.aria-controls]="panelId()"
          (click)="select(tab.id)"
        >
          @if (tab.icon) {
            <ui-icon [name]="tab.icon" [size]="16" />
          }
          <span class="ui-tab__label">{{ tab.label }}</span>
          @if (tab.badge !== null && tab.badge !== undefined) {
            <span class="ui-tab__badge">{{ tab.badge }}</span>
          }
        </button>
      }
    </div>

    <div class="ui-tabs__panel" role="tabpanel" [id]="panelId()" [attr.aria-labelledby]="labelledBy()">
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ui-tabs__bar {
        display: flex;
        align-items: flex-end;
        gap: var(--sp-1);
        border-bottom: 1px solid var(--border);
        overflow-x: auto;
        scrollbar-width: thin;
      }
      .ui-tab {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-3);
        border: 0;
        background: transparent;
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--text-muted);
        cursor: pointer;
        white-space: nowrap;
        border-radius: var(--radius-input) var(--radius-input) 0 0;
        transition:
          color var(--duration) var(--ease),
          background var(--duration) var(--ease);
      }
      .ui-tab:hover {
        color: var(--text);
        background: var(--bg-hover);
      }
      .ui-tab:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .ui-tab[aria-selected='true'] {
        color: var(--primary);
      }
      .ui-tab::after {
        content: '';
        position: absolute;
        inset-inline: var(--sp-2);
        inset-block-end: 0;
        height: 2px;
        border-radius: var(--radius-pill);
        background: var(--primary);
        transform: scaleX(0);
        transform-origin: center;
        transition: transform var(--duration) var(--ease);
      }
      .ui-tab[aria-selected='true']::after {
        transform: scaleX(1);
      }
      .ui-tab__badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--sp-5);
        height: var(--sp-5);
        padding-inline: var(--sp-1);
        border-radius: var(--radius-pill);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        color: var(--text-muted);
        font-size: var(--fs-xs);
        font-weight: 650;
      }
      .ui-tab[aria-selected='true'] .ui-tab__badge {
        background: var(--primary-soft);
        border-color: var(--primary);
        color: var(--primary);
      }
      .ui-tabs__panel {
        padding-block: var(--sp-4);
        min-width: 0;
      }
      @media (max-width: 1024px) {
        .ui-tab {
          padding: var(--sp-2);
        }
      }
    `,
  ],
})
export class UiTabsComponent {
  readonly tabs = input<UiTab[]>([]);
  /** Two-way: `[(active)]="activeTab()"`, which also emits `activeChange`. */
  readonly active = model('');

  private readonly instance = nextTabsInstance++;
  private readonly element = inject(ElementRef<HTMLElement>);

  protected readonly current = computed(() => {
    const list = this.tabs();
    const active = this.active();
    return list.some((tab) => tab.id === active) ? active : (list[0]?.id ?? '');
  });

  protected readonly panelId = computed(() => `ui-tabs-panel-${this.instance}`);

  protected readonly labelledBy = computed(() => (this.current() === '' ? null : this.tabId(this.current())));

  protected tabId(id: string): string {
    return `ui-tab-${this.instance}-${id}`;
  }

  protected select(id: string): void {
    if (id === this.active()) return;
    this.active.set(id);
  }

  /** Roving tabindex: arrows walk the list, Home/End jump to its edges. */
  protected onKeydown(event: KeyboardEvent): void {
    const list = this.tabs();
    const last = list.length - 1;
    if (last < 0) return;
    const step = TAB_KEYS.get(event.key);
    if (step === undefined) return;
    event.preventDefault();
    const index = list.findIndex((tab) => tab.id === this.current());
    const target = step === 'first' ? 0 : step === 'last' ? last : (index + step + list.length) % list.length;
    const tab = list[target];
    if (!tab) return;
    this.select(tab.id);
    this.focusTab(target);
  }

  /** The active tab is the only one in the tab order, so focus must follow. */
  private focusTab(index: number): void {
    const buttons = (this.element.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons.item(index)?.focus();
  }
}
