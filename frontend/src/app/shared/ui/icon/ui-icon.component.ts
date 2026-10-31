import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ICONS, type IconName } from './icons';

/**
 * One entry point for every glyph in the product, so a screen never imports an
 * icon library by itself and the drawn stroke always matches the text size.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-icon',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<lucide-icon [img]="data()" [size]="pixels()" class="ui-icon" aria-hidden="true"></lucide-icon>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        line-height: 0;
      }
      .ui-icon {
        color: inherit;
      }
    `,
  ],
})
export class UiIconComponent {
  readonly name = input<IconName | string>('info');
  // templates write both size="16" (attribute, therefore string) and [size]="16"
  readonly size = input<number | string>(18);
  protected readonly data = computed(() => ICONS[this.name() as IconName]);
  protected readonly pixels = computed(() => {
    const value = Number(this.size());
    return Number.isFinite(value) && value > 0 ? value : 18;
  });
}
