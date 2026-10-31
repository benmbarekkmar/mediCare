import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Ref } from '../../../core/api/models';
import { UiModalComponent } from '../modal/ui-modal.component';
import { UiIconComponent } from '../icon/ui-icon.component';

/** One record that would lose its link when the owner is deleted. */
export interface ConfirmDependent {
  entity: string;
  id: string;
  label: string;
  predicate: string;
}

/** The dependents grouped by the entity they belong to. */
interface DependentGroup {
  entity: string;
  items: ConfirmDependent[];
}

let nextReassignSequence = 0;

/**
 * The declarative delete confirmation. It lists every dependent record, and when
 * the linked records can be moved it refuses to confirm until a target is picked.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-confirm-dialog',
  standalone: true,
  imports: [UiModalComponent, UiIconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal
      size="sm"
      [open]="open()"
      [title]="title()"
      [busy]="busy()"
      [dismissible]="!busy()"
      (openChange)="onOpenChange($event)"
    >
      @if (message()) {
        <p class="ui-confirm__message">{{ message() }}</p>
      }

      @if (hasDependents()) {
        <section class="ui-confirm__dependents">
          <p class="ui-confirm__warning">
            <ui-icon class="ui-confirm__warning-icon" name="triangle-alert" size="16" />
            <span>{{ 'ui.confirm.dependentsWarning' | translate: { count: dependentCount() } }}</span>
          </p>

          @for (group of groups(); track group.entity) {
            <div class="ui-confirm__group">
              <h3 class="ui-confirm__group-title">{{ group.entity }}</h3>
              <ul class="ui-confirm__list">
                @for (row of group.items; track row.id) {
                  <li class="ui-confirm__item">
                    <span class="ui-confirm__item-label">{{ row.label }}</span>
                    <span class="ui-confirm__item-predicate">{{ row.predicate }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        </section>
      }

      @if (requiresReassign()) {
        <div class="ui-field ui-confirm__reassign">
          <label class="ui-label ui-label--required" [attr.for]="reassignId">
            {{ 'uioverlay.confirm.reassignLabel' | translate }}
          </label>
          <select
            class="ui-control"
            [attr.id]="reassignId"
            [value]="reassignTo() ?? ''"
            [disabled]="busy()"
            (change)="onReassignChange($event)"
          >
            <option value="">{{ 'uioverlay.confirm.reassignPlaceholder' | translate }}</option>
            @for (option of reassignOptions(); track option.id) {
              <option [value]="option.id">{{ option.label }}</option>
            }
          </select>
          <p class="ui-hint">{{ 'ui.confirm.reassignRequired' | translate }}</p>
        </div>
      }

      <ng-template #footer>
        <button type="button" class="ui-confirm__button ui-confirm__button--ghost" [disabled]="busy()" (click)="cancel()">
          {{ 'ui.confirm.cancel' | translate }}
        </button>
        <button
          type="button"
          class="ui-confirm__button"
          [class.ui-confirm__button--danger]="danger()"
          [class.ui-confirm__button--primary]="!danger()"
          [disabled]="confirmDisabled()"
          (click)="confirm()"
        >
          {{ confirmLabel() ?? ('ui.confirm.delete' | translate) }}
        </button>
      </ng-template>
    </ui-modal>
  `,
  styles: [
    `
      .ui-confirm__message {
        margin: 0 0 var(--sp-3);
        color: var(--text);
        font-size: var(--fs-base);
      }
      .ui-confirm__dependents {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
        margin-block-end: var(--sp-4);
      }
      .ui-confirm__warning {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        margin: 0;
        padding: var(--sp-2) var(--sp-3);
        font-size: var(--fs-sm);
        color: var(--text);
        background: var(--warning-50);
        border: 1px solid var(--warning-100);
        border-radius: var(--radius-input);
      }
      .ui-confirm__warning-icon {
        color: var(--warning-700);
      }
      .ui-confirm__group-title {
        margin: 0 0 var(--sp-1);
        font-size: var(--fs-xs);
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-subtle);
      }
      .ui-confirm__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        max-height: min(40vh, 240px);
        overflow-y: auto;
      }
      .ui-confirm__item {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--sp-2);
        padding: var(--sp-1) var(--sp-2);
        font-size: var(--fs-sm);
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
      }
      .ui-confirm__item-label {
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .ui-confirm__item-predicate {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--text-subtle);
      }
      .ui-confirm__reassign {
        gap: var(--sp-1);
      }
      .ui-confirm__button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sp-2);
        min-height: 36px;
        padding: 0 var(--sp-4);
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 600;
        border: 1px solid transparent;
        border-radius: var(--radius-input);
        cursor: pointer;
        transition:
          background var(--duration-fast) var(--ease),
          color var(--duration-fast) var(--ease),
          border-color var(--duration-fast) var(--ease);

        &:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      }
      .ui-confirm__button--ghost {
        color: var(--text-muted);
        background: transparent;
        border-color: var(--border);

        &:hover:not(:disabled) {
          color: var(--text);
          background: var(--bg-hover);
        }
      }
      .ui-confirm__button--danger {
        color: var(--text-inverse);
        background: var(--danger-500);

        &:hover:not(:disabled) {
          background: var(--danger-700);
        }
      }
      .ui-confirm__button--primary {
        color: var(--text-inverse);
        background: var(--primary);

        &:hover:not(:disabled) {
          background: var(--primary-hover);
        }
      }
    `,
  ],
})
export class UiConfirmDialogComponent {
  readonly open = model<boolean>(false);
  readonly title = input.required<string>();
  readonly message = input<string | null>(null);
  readonly confirmLabel = input<string | null>(null);
  readonly danger = input<boolean>(true);
  readonly busy = input<boolean>(false);
  readonly dependents = input<ConfirmDependent[] | null>(null);
  readonly reassignOptions = input<Ref[] | null>(null);
  /** Two-way: the id of the record the dependents move to. */
  readonly reassignTo = model<string | null>(null);

  readonly confirmed = output<void>();

  protected readonly reassignId = `ui-confirm-reassign-${(nextReassignSequence += 1)}`;
  protected readonly dependentCount = computed(() => this.dependents()?.length ?? 0);
  protected readonly hasDependents = computed(() => this.dependentCount() > 0);
  protected readonly requiresReassign = computed(() => (this.reassignOptions()?.length ?? 0) > 0);

  protected readonly groups = computed<DependentGroup[]>(() => {
    const byEntity = new Map<string, ConfirmDependent[]>();
    for (const row of this.dependents() ?? []) {
      const bucket = byEntity.get(row.entity);
      if (bucket) {
        bucket.push(row);
      } else {
        byEntity.set(row.entity, [row]);
      }
    }
    return [...byEntity].map(([entity, items]) => ({ entity, items }));
  });

  /** The gate: a delete with movable dependents needs an explicit target. */
  protected readonly confirmDisabled = computed(
    () => this.busy() || (this.requiresReassign() && !this.reassignTo()),
  );

  protected onOpenChange(value: boolean): void {
    this.open.set(value);
  }

  protected onReassignChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.reassignTo.set(target.value === '' ? null : target.value);
  }

  protected confirm(): void {
    if (this.confirmDisabled()) return;
    this.confirmed.emit();
  }

  protected cancel(): void {
    if (this.busy()) return;
    this.open.set(false);
  }
}
