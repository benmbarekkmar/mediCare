import { ChangeDetectionStrategy, Component, effect, input, model, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';

let nextSearchBoxId = 0;

/**
 * The search field used in toolbars and list headers. The typed text is kept
 * locally and only published after `debounceMs`, so typing never navigates or
 * fires a request on every keystroke; Enter publishes it immediately.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-search-box',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sb" role="search">
      <label class="visually-hidden" [attr.for]="id">{{ 'ui.search.label' | translate }}</label>
      <span class="sb__icon" aria-hidden="true">
        <ui-icon [name]="loading() ? 'loader' : 'search'" size="16"></ui-icon>
      </span>
      <input
        #field
        class="ui-control sb__input"
        type="search"
        [id]="id"
        [value]="term()"
        [attr.placeholder]="placeholder()"
        [attr.aria-busy]="loading() ? 'true' : 'false'"
        (input)="onInput(field.value)"
        (keydown.enter)="onEnter(field.value)"
      />
      @if (loading()) {
        <span class="visually-hidden" aria-live="polite">{{ 'common.loading' | translate }}</span>
      }
      @if (term()) {
        <button type="button" class="sb__clear" [attr.aria-label]="'ui.search.clear' | translate" (click)="clear()">
          <ui-icon name="x" size="16"></ui-icon>
        </button>
      }
    </div>
    @if (hint()) {
      <p class="ui-hint">{{ hint() }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .sb {
        position: relative;
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .sb__icon {
        position: absolute;
        inset-inline-start: var(--sp-3);
        display: inline-flex;
        color: var(--text-subtle);
        pointer-events: none;
      }
      .sb__input {
        padding-inline-start: 34px;
        padding-inline-end: 34px;
      }
      .sb__input::-webkit-search-cancel-button,
      .sb__input::-webkit-search-decoration {
        display: none;
        appearance: none;
      }
      .sb__clear {
        position: absolute;
        inset-inline-end: var(--sp-1);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        font: inherit;
        color: var(--text-muted);
        background: transparent;
        border: 0;
        border-radius: var(--radius-pill);
        cursor: pointer;
        transition:
          color var(--duration) var(--ease),
          background var(--duration) var(--ease);
      }
      .sb__clear:hover {
        color: var(--danger-500);
        background: var(--bg-hover);
      }
      :host > .ui-hint {
        margin: 0;
      }
    `,
  ],
})
export class UiSearchBoxComponent {
  readonly placeholder = input<string>('');
  /** Published debounced; `[(value)]` keeps the page and the field in step. */
  readonly value = model<string>('');
  readonly debounceMs = input<number>(300);
  readonly loading = input<boolean>(false);
  readonly hint = input<string | null>(null);
  /** Enter pressed: the term is published at once. */
  readonly submitted = output<string>();

  readonly id = `ui-search-box-${nextSearchBoxId++}`;
  protected readonly term = this.value;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** the last value we saw coming from the binding, so our own emit is ignored */
  private fromParent = this.value();

  constructor() {
    effect(() => {
      const incoming = this.value();
      if (incoming === this.fromParent) return;
      this.fromParent = incoming;
      this.cancel();
      this.term.set(incoming);
    });
  }

  protected onInput(next: string): void {
    this.term.set(next);
    this.cancel();
    this.timer = setTimeout(() => this.publish(next), this.debounceMs());
  }

  protected onEnter(next: string): void {
    this.cancel();
    this.publish(next);
    this.submitted.emit(next);
  }

  protected clear(): void {
    this.cancel();
    this.term.set('');
    this.publish('');
  }

  protected ngOnDestroy(): void {
    this.cancel();
  }

  private publish(next: string): void {
    this.fromParent = next;
    this.value.set(next);
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
