import { Location } from '@angular/common';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, contentChild, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import type { IconName } from '../icon/icons';
import { UiIconComponent } from '../icon/ui-icon.component';
import { UiPageActionsDirective } from './ui-page-actions.directive';
import { UiPageMetaDirective } from './ui-page-meta.directive';

/**
 * The title block every screen starts with: one `h1`, an optional breadcrumb
 * rendered by the page above it, the meta chips under the title and the actions
 * on the right. It is sticky only on desktop, where it stays under the topbar.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-page-header',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="ph" [class.ph--hero]="tone() === 'hero'">
      <div class="ph__row">
        @if (backHref()) {
          <a class="ph__back" [routerLink]="backHref()" [attr.aria-label]="'ui.pageHeader.back' | translate">
            <ui-icon name="arrow-left" size="18"></ui-icon>
            <span class="ph__back-text">{{ 'ui.pageHeader.back' | translate }}</span>
          </a>
        } @else if (showsBack()) {
          <button type="button" class="ph__back" (click)="goBack()" [attr.aria-label]="'ui.pageHeader.back' | translate">
            <ui-icon name="arrow-left" size="18"></ui-icon>
            <span class="ph__back-text">{{ 'ui.pageHeader.back' | translate }}</span>
          </button>
        }

        <div class="ph__titles">
          <h1 class="ph__title">
            @if (icon(); as glyph) {
              <ui-icon class="ph__icon" [name]="glyph" size="24"></ui-icon>
            }
            <span class="truncate">{{ title() }}</span>
          </h1>

          @if (subtitle()) {
            <p class="ph__subtitle">{{ subtitle() }}</p>
          }

          <div class="ph__meta">
            @if (metaTemplate()) {
              <ng-container [ngTemplateOutlet]="metaTemplate()"></ng-container>
            }
            <ng-content select="[uiPageMeta]"></ng-content>
          </div>
        </div>

        <div class="ph__actions">
          @if (actionsTemplate()) {
            <ng-container [ngTemplateOutlet]="actionsTemplate()"></ng-container>
          }
          <ng-content select="[uiPageActions]"></ng-content>
        </div>
      </div>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ph {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-sm);
        padding: var(--sp-4) var(--sp-5);
      }
      .ph--hero {
        position: relative;
        overflow: hidden;
        isolation: isolate;
        border: 0;
        background: var(--gradient-banner);
        box-shadow: var(--shadow-md);
      }
      .ph--hero::after {
        content: '';
        position: absolute;
        z-index: 0;
        inset-block-start: -13rem;
        inset-inline-end: -9rem;
        width: 25rem;
        height: 25rem;
        border-radius: 50%;
        background: radial-gradient(circle, rgb(255 255 255 / 18%), rgb(255 255 255 / 0%) 68%);
        pointer-events: none;
      }
      .ph--hero .ph__row {
        position: relative;
        z-index: 1;
      }
      .ph--hero .ph__title,
      .ph--hero .ph__icon {
        color: #fff;
      }
      .ph--hero .ph__subtitle {
        color: rgb(255 255 255 / 82%);
      }
      .ph--hero .ph__back {
        color: #fff;
        border-color: rgb(255 255 255 / 28%);
        background: rgb(255 255 255 / 12%);
      }
      .ph--hero .ph__back:hover {
        border-color: rgb(255 255 255 / 60%);
        background: rgb(255 255 255 / 20%);
      }
      .ph__row {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-4);
        min-width: 0;
        flex-wrap: wrap;
      }
      .ph__back {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        flex: none;
        font: inherit;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        padding: var(--sp-1) var(--sp-3);
        text-decoration: none;
        cursor: pointer;
        transition:
          color var(--duration) var(--ease),
          border-color var(--duration) var(--ease),
          background var(--duration) var(--ease);
      }
      .ph__back:hover {
        color: var(--primary);
        border-color: var(--primary);
        text-decoration: none;
      }
      .ph__back-text {
        display: none;
      }
      .ph__titles {
        flex: 1 1 240px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
      .ph__title {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        min-width: 0;
        margin: 0;
        font-size: var(--fs-2xl);
        line-height: 1.2;
        color: var(--text);
      }
      .ph__icon {
        color: var(--primary);
      }
      .ph__subtitle {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .ph__meta,
      .ph__actions {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
        min-width: 0;
        margin-block-start: var(--sp-1);
      }
      .ph__actions {
        margin-block-start: 0;
        align-self: center;
      }
      .ph__meta:not(:has(*)),
      .ph__actions:not(:has(*)) {
        display: none;
      }
      @media (min-width: 640px) {
        .ph__back-text {
          display: inline;
        }
        .ph__title {
          font-size: var(--fs-3xl);
        }
      }
      @media (min-width: 1024.02px) {
        .ph {
          position: sticky;
          inset-block-start: var(--sp-2);
          z-index: var(--z-sticky);
        }
        .ph__row {
          flex-wrap: nowrap;
        }
        .ph__actions {
          flex: none;
        }
      }
    `,
  ],
})
export class UiPageHeaderComponent {
  readonly tone = input<'default' | 'hero'>('default');
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly icon = input<IconName | null>(null);
  /** `true` replays history, a string is used as the `routerLink` destination. */
  readonly back = input<boolean | string>(false);

  private readonly location = inject(Location);

  protected readonly showsBack = computed(() => this.back() === true);
  protected readonly backHref = computed<string | null>(() => {
    const value = this.back();
    return typeof value === 'string' && value.length > 0 ? value : null;
  });
  protected readonly actionsSlot = contentChild(UiPageActionsDirective);
  protected readonly metaSlot = contentChild(UiPageMetaDirective);
  protected readonly actionsTemplate = computed(() => this.actionsSlot()?.template ?? null);
  protected readonly metaTemplate = computed(() => this.metaSlot()?.template ?? null);

  protected goBack(): void {
    this.location.back();
  }
}
