import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PublicService } from '../../core/api/entity.service';
import type { EntityKey, Individual, Page, Ref } from '../../core/api/models';
import { labelOf } from '../../core/util/labels';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiSearchBoxComponent } from '../../shared/ui/search-box/ui-search-box.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import type { IconName } from '../../shared/ui/icon/icons';

/**
 * The anonymous catalogue: diseases, doctors, hospitals… as card grids served by
 * `/api/public/:entity`, which never returns patient data. The metadata registry
 * belongs to the authenticated API, so this page reads the values off the rows
 * themselves and humanises the property names it is given.
 */
@Component({
  selector: 'page-browse',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    UiCardComponent,
    UiSearchBoxComponent,
    UiIconComponent,
    UiSkeletonComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="browse__head">
        <div>
          <h1 class="browse__title">{{ title() }}</h1>
          <p class="browse__lede">{{ lede() }}</p>
        </div>
        <ui-search-box
          [value]="term()"
          [placeholder]="'nav.searchPlaceholder' | translate"
          (valueChange)="onSearch($event)"
        />
      </header>

      @if (failed()) {
        <ui-error-state [title]="'detail.notFound' | translate" [message]="''" (retry)="load()" />
      } @else if (loading()) {
        <div class="grid-auto">
          @for (i of [0, 1, 2, 3, 4, 5]; track i) {
            <ui-card><ui-skeleton height="6rem" /></ui-card>
          }
        </div>
      } @else if (total() === 0) {
        <ui-card>
          <ui-empty-state
            icon="search"
            [title]="'common.noResults' | translate"
            [hint]="'common.noResultsHint' | translate"
          />
        </ui-card>
      } @else {
        <div class="grid-auto">
          @for (row of rows(); track row.id) {
            <a class="tile" [routerLink]="[row.id]">
              <span class="tile__icon"><ui-icon [name]="icon" [size]="18" /></span>
              <h3 class="tile__title truncate">{{ row.label }}</h3>
              <ul class="tile__facts">
                @for (fact of facts(row); track fact.label) {
                  <li>
                    <span>{{ fact.label }}</span>
                    <strong class="truncate">{{ fact.value }}</strong>
                  </li>
                }
              </ul>
              <p class="tile__types">
                @for (type of row.types.slice(0, 2); track type) {
                  <span>{{ labelOfValue(type) }}</span>
                }
              </p>
            </a>
          }
        </div>
        <p class="browse__count">
          {{ 'uipage.showing' | translate: { count: rows().length, total: total() } }}
        </p>
      }
    </div>
  `,
  styleUrls: ['./browse.component.scss'],
})
export class PublicBrowseComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicService);
  private readonly translate = inject(TranslateService);

  protected readonly entity = (this.route.snapshot.data['entity'] ?? 'diseases') as EntityKey;
  protected readonly icon = (this.route.snapshot.data['icon'] ?? 'book') as IconName;

  protected readonly rows = signal<Individual[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly term = signal('');

  constructor() {
    this.load();
  }

  protected title(): string {
    return this.translate.instant((this.route.snapshot.data['titleKey'] as string | undefined) ?? 'library.title');
  }

  protected lede(): string {
    const key = this.route.snapshot.data['ledeKey'] as string | undefined;
    return key ? this.translate.instant(key) : '';
  }

  protected onSearch(value: string): void {
    this.term.set(value);
    this.debounce();
  }

  /** Three short facts per tile: the first scalar values, then the linked labels. */
  protected facts(row: Individual): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    for (const [field, raw] of Object.entries(row.fields)) {
      if (out.length >= 3) break;
      if (raw === null || raw === undefined || String(raw).length === 0) continue;
      if (field === row.label) continue;
      out.push({ label: labelOf(this.translate, `entities.fields.${field}`, field), value: String(raw) });
    }
    for (const [field, value] of Object.entries(row.relations)) {
      if (out.length >= 4) break;
      const labels = this.refsOf(value).map((ref) => ref.label);
      if (labels.length === 0) continue;
      out.push({
        label: labelOf(this.translate, `entities.relations.${field}`, field),
        value: labels.slice(0, 3).join(', ') + (labels.length > 3 ? '…' : ''),
      });
    }
    return out;
  }

  protected labelOfValue(value: string): string {
    return labelOf(this.translate, `entities.values.${value}`, value);
  }

  private refsOf(value: Ref[] | Ref | null): Ref[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  private timer: ReturnType<typeof setTimeout> | null = null;

  private debounce(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.list(this.entity, { q: this.term() || undefined, pageSize: 24 }).subscribe({
      next: (page: Page<Individual>) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }
}
