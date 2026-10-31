import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { Role } from '../../../core/api/models';
import { initials } from '../../../core/util/format';
import { UiIconComponent } from '../icon/ui-icon.component';

export type AvatarSize = 'sm' | 'md' | 'lg';

/**
 * A person or an account: initials by default, a picture when the API has one,
 * and the role colours the directory, the audit log and the record panels use.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-avatar',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="ui-avatar"
      role="img"
      [attr.data-size]="size()"
      [attr.data-role]="role() ?? null"
      [attr.title]="name()"
      [attr.aria-label]="'ui.avatar.initials' | translate: { name: name() || ('uidata.avatar.unknown' | translate) }"
    >
      @if (src()) {
        <img class="ui-avatar__img" [src]="src() ?? ''" alt="" />
      } @else if (letters()) {
        <span class="ui-avatar__letters" aria-hidden="true">{{ letters() }}</span>
      } @else {
        <ui-icon class="ui-avatar__fallback" name="user" [size]="glyphSize()" />
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: none;
      }
      .ui-avatar {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: var(--radius-pill);
        font-weight: 650;
        letter-spacing: 0.02em;
        background: var(--avatar-soft, var(--primary-soft));
        color: var(--avatar-text, var(--primary));
        border: 1px solid var(--border);
        user-select: none;
      }
      .ui-avatar[data-size='sm'] {
        width: var(--sp-5);
        height: var(--sp-5);
        font-size: var(--fs-xs);
      }
      .ui-avatar[data-size='md'] {
        width: var(--sp-6);
        height: var(--sp-6);
        font-size: var(--fs-sm);
      }
      .ui-avatar[data-size='lg'] {
        width: var(--sp-7);
        height: var(--sp-7);
        font-size: var(--fs-lg);
      }
      .ui-avatar[data-role='ADMIN'] {
        --avatar-soft: var(--danger-50);
        --avatar-text: var(--danger-700);
      }
      .ui-avatar[data-role='DOCTOR'] {
        --avatar-soft: var(--primary-soft);
        --avatar-text: var(--primary);
      }
      .ui-avatar[data-role='RECEPTIONIST'] {
        --avatar-soft: var(--secondary-soft);
        --avatar-text: var(--secondary);
      }
      .ui-avatar[data-role='PATIENT'] {
        --avatar-soft: var(--accent-soft);
        --avatar-text: var(--accent);
      }
      .ui-avatar__img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .ui-avatar__letters {
        line-height: 1;
      }
      .ui-avatar__fallback {
        color: inherit;
      }
    `,
  ],
})
export class UiAvatarComponent {
  readonly name = input('');
  readonly size = input<AvatarSize>('md');
  readonly role = input<Role | null>(null);
  readonly src = input<string | null>(null);

  protected readonly letters = computed(() => initials(this.name()));

  protected readonly glyphSize = computed(() => (this.size() === 'lg' ? 24 : this.size() === 'md' ? 18 : 14));
}
