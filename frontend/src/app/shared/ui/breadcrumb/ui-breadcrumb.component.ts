import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UiIconComponent } from '../icon/ui-icon.component';

export interface BreadcrumbCrumb {
  label: string;
  /** Router destination; the last crumb (and any non-navigable one) has none. */
  href?: string | null;
}

/** short alias so a page can write `Crumb[]` without importing the long name */
export type Crumb = BreadcrumbCrumb;

/**
 * The trail above a detail page. The last crumb is the current page and is plain
 * text, never a link, so a screen reader announces where the user is.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-breadcrumb',
  standalone: true,
  imports: [RouterLink, TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (crumbs().length > 0) {
      <nav class="crumbs" [attr.aria-label]="'uipage.breadcrumb.label' | translate">
        <ol class="crumbs__list">
          @for (crumb of crumbs(); track $index; let isFirst = $first; let isLast = $last) {
            <li class="crumbs__item">
              @if (!isFirst) {
                <span class="crumbs__sep" aria-hidden="true">
                  <ui-icon name="chevron-right" size="14"></ui-icon>
                </span>
              }
              @if (isLast) {
                <span class="crumbs__current" aria-current="page">{{ crumb.label }}</span>
              } @else if (crumb.href) {
                <a class="crumbs__link" [routerLink]="crumb.href">{{ crumb.label }}</a>
              } @else {
                <span class="crumbs__plain">{{ crumb.label }}</span>
              }
            </li>
          }
        </ol>
      </nav>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .crumbs__list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-1);
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: var(--fs-sm);
      }
      .crumbs__item {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        min-width: 0;
      }
      .crumbs__sep {
        display: inline-flex;
        color: var(--text-subtle);
      }
      .crumbs__link {
        color: var(--text-muted);
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .crumbs__link:hover {
        color: var(--primary);
        text-decoration: underline;
      }
      .crumbs__plain {
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .crumbs__current {
        color: var(--text);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class UiBreadcrumbComponent {
  readonly crumbs = input<BreadcrumbCrumb[]>([]);
}
