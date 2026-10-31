import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PublicService } from '../../core/api/entity.service';
import type { EntityKey, Individual, Ref } from '../../core/api/models';
import { formatDate, formatDateTime } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';

/** The catalogues an anonymous visitor may open; clinical rows are never listed. */
const PUBLIC_PATHS: Record<string, string> = {
  Disease: 'library',
  Symptom: 'symptoms',
  Treatment: 'treatments',
  Medication: 'medications',
  Hospital: 'hospitals',
  Department: 'departments',
  Doctor: 'find-a-doctor',
};

/** Read-only view of one knowledge or directory individual, no token needed. */
@Component({
  selector: 'page-public-detail',
  standalone: true,
  imports: [RouterLink, TranslateModule, UiCardComponent, UiButtonComponent, UiSkeletonComponent, UiErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (loading()) {
        <ui-card><ui-skeleton height="8rem" /></ui-card>
      } @else if (failed()) {
        <ui-error-state [title]="'detail.notFound' | translate" [message]="''" [hint]="'detail.notFoundHint' | translate" (retry)="load()" />
      } @else {
        @if (row(); as item) {
        <div class="row">
          <ui-button variant="ghost" size="sm" icon="arrow-left" [href]="back()">{{ 'common.back' | translate }}</ui-button>
        </div>
        <h1 class="title">{{ item.label }}</h1>
        <p class="types">
          @for (type of item.types; track type) {
            <span>{{ labelOfValue(type) }}</span>
          }
        </p>

        <div class="grid">
          <ui-card [title]="'detail.data' | translate">
            <dl class="fields">
              @for (field of fields(item); track field.label) {
                <div>
                  <dt>{{ field.label }}</dt>
                  <dd>{{ field.value }}</dd>
                </div>
              }
            </dl>
          </ui-card>

          @for (group of relations(item); track group.label) {
            <ui-card [title]="group.label">
              <ul class="links">
                @for (ref of group.items; track ref.id) {
                  <li>
                    @if (ref.href) {
                      <a [routerLink]="ref.href">{{ ref.label }}</a>
                    } @else {
                      <span>{{ ref.label }}</span>
                    }
                  </li>
                }
              </ul>
            </ui-card>
          }
        </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .title {
        margin: var(--sp-2) 0;
        font-size: var(--fs-2xl);
        font-weight: 700;
      }
      .types {
        display: flex;
        gap: var(--sp-1);
        flex-wrap: wrap;
        margin: 0 0 var(--sp-5);

        span {
          padding: 2px 8px;
          border-radius: var(--radius-pill);
          background: var(--bg-sunken);
          color: var(--text-subtle);
          font-size: var(--fs-xs);
        }
      }
      .row {
        display: flex;
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        margin: 0;

        div {
          display: flex;
          justify-content: space-between;
          gap: var(--sp-4);
          padding-bottom: var(--sp-2);
          border-bottom: 1px solid var(--border);
          font-size: var(--fs-sm);

          &:last-child {
            border-bottom: 0;
          }
        }

        dt {
          color: var(--text-subtle);
        }

        dd {
          margin: 0;
          text-align: right;
          overflow-wrap: anywhere;
        }
      }
      .links {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        margin: 0;
        padding: 0;
        list-style: none;

        a {
          color: var(--primary-600);
          font-size: var(--fs-sm);
          text-decoration: none;
        }
      }
    `,
  ],
})
export class PublicDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicService);
  private readonly translate = inject(TranslateService);

  protected readonly row = signal<Individual | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  private readonly entity = (this.route.snapshot.data['entity'] ?? 'diseases') as EntityKey;

  constructor() {
    this.load();
  }

  protected load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.loading.set(true);
    this.api.get(this.entity, id).subscribe({
      next: (row) => {
        this.row.set(row);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  protected back(): string {
    return `/${(this.route.snapshot.url[0]?.path ?? 'library').toString()}`;
  }

  protected labelOfValue(value: string): string {
    return labelOf(this.translate, `entities.values.${value}`, value);
  }

  protected fields(row: Individual): { label: string; value: string }[] {
    const lang = this.translate.currentLang ?? 'en';
    return Object.entries(row.fields)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => ({
        label: labelOf(this.translate, `entities.fields.${key}`, key),
        value: /date/i.test(key) ? formatDateTime(String(value), lang) : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(String(value), lang) : String(value),
      }));
  }

  protected relations(row: Individual): { label: string; items: { id: string; label: string; href: string | null }[] }[] {
    return Object.entries(row.relations)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => ({
        label: labelOf(this.translate, `entities.relations.${key}`, key),
        items: (Array.isArray(value) ? value : [value]).filter((ref): ref is Ref => ref !== null && ref !== undefined).map((ref: Ref) => ({
          id: ref.id,
          label: ref.label,
          href: this.hrefOf(ref),
        })),
      }));
  }

  /** Only rows that belong to a published catalogue get a link. */
  private hrefOf(ref: Ref): string | null {
    const segment = PUBLIC_PATHS[ref.type ?? ''];
    return segment ? `/${segment}/${ref.id}` : null;
  }
}
