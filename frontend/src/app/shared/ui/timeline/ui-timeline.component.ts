import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { type Lang, SUPPORTED_LANGS } from '../../../core/i18n/i18n';
import { formatDate, relativeTime } from '../../../core/util/format';

export type TimelineKind = 'appointment' | 'test' | 'diagnosis' | 'treatment' | 'note';

export interface TimelineItem {
  id?: string;
  title: string;
  date: string;
  kind?: TimelineKind;
  detail?: string | null;
  link?: string | null;
}

interface TimelineEntry {
  key: string;
  item: TimelineItem;
  kind: TimelineKind;
  statusClass: string;
  day: string;
  relative: string;
  timestamp: number;
}

/** The status vocabulary behind _utilities.scss, per timeline flavour. */
const KIND_CLASS: Record<TimelineKind, string> = {
  appointment: 'status-scheduled',
  test: 'status-info',
  diagnosis: 'status-confirmed',
  treatment: 'status-pending',
  note: 'status-info',
};

/**
 * Vertical rail of clinical events, newest first, coloured with the same status
 * vocabulary the tables and the badges use.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-timeline',
  standalone: true,
  imports: [NgClass, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="ui-timeline" [attr.aria-label]="'ui.timeline.label' | translate">
      @for (entry of entries(); track entry.key) {
        <li class="ui-timeline__item" [attr.data-kind]="entry.kind" [ngClass]="entry.statusClass">
          <span class="ui-timeline__dot" aria-hidden="true"></span>
          <div class="ui-timeline__body">
            <div class="ui-timeline__head">
              @if (entry.item.link) {
                <a class="ui-timeline__title" [routerLink]="entry.item.link">{{ entry.item.title }}</a>
              } @else {
                <span class="ui-timeline__title">{{ entry.item.title }}</span>
              }
              <span class="ui-timeline__date" [attr.title]="entry.item.date">
                {{ entry.day }}
                <small class="ui-timeline__relative">{{ entry.relative }}</small>
              </span>
            </div>
            @if (entry.item.detail) {
              <p class="ui-timeline__detail">{{ entry.item.detail }}</p>
            }
          </div>
        </li>
      } @empty {
        <li class="ui-timeline__empty">
          <p class="ui-timeline__empty-title">{{ 'ui.empty.title' | translate }}</p>
          <p class="ui-timeline__empty-hint">{{ 'ui.empty.hint' | translate }}</p>
        </li>
      }
    </ol>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ui-timeline {
        list-style: none;
        margin: 0;
        padding: 0 0 0 var(--sp-5);
        position: relative;
      }
      .ui-timeline::before {
        content: '';
        position: absolute;
        inset-block: var(--sp-2) var(--sp-2);
        inset-inline-start: var(--sp-2);
        width: 2px;
        background: var(--border);
        border-radius: var(--radius-pill);
      }
      .ui-timeline__item {
        position: relative;
        display: flex;
        gap: var(--sp-3);
        padding-block: var(--sp-3);
      }
      .ui-timeline__item + .ui-timeline__item {
        border-top: 1px solid var(--border);
      }
      .ui-timeline__dot {
        position: absolute;
        inset-inline-start: calc(var(--sp-5) * -1 + var(--sp-1));
        inset-block-start: var(--sp-4);
        width: 10px;
        height: 10px;
        border-radius: var(--radius-pill);
        background: var(--status-color, var(--text-subtle));
        box-shadow: 0 0 0 3px var(--surface);
      }
      .ui-timeline__body {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
      }
      .ui-timeline__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--sp-3);
        flex-wrap: wrap;
      }
      .ui-timeline__title {
        font-weight: 600;
        color: var(--text);
        min-width: 0;
      }
      a.ui-timeline__title {
        color: var(--primary);
      }
      .ui-timeline__date {
        font-size: var(--fs-sm);
        color: var(--text-muted);
        white-space: nowrap;
        display: inline-flex;
        gap: var(--sp-2);
        align-items: baseline;
      }
      .ui-timeline__relative {
        color: var(--text-subtle);
      }
      .ui-timeline__detail {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .ui-timeline__empty {
        padding: var(--sp-4) 0;
        list-style: none;
      }
      .ui-timeline__empty-title {
        margin: 0;
        font-weight: 600;
      }
      .ui-timeline__empty-hint {
        margin: var(--sp-1) 0 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
    `,
  ],
})
export class UiTimelineComponent {
  readonly items = input<TimelineItem[]>([]);

  private readonly lang = computed<Lang>(() => {
    const htmlLang = document.documentElement.lang;
    return (SUPPORTED_LANGS as readonly string[]).includes(htmlLang) ? (htmlLang as Lang) : 'en';
  });

  protected readonly entries = computed<TimelineEntry[]>(() =>
    this
      .items()
      .map((item, index) => this.toEntry(item, index))
      .sort((a, b) => b.timestamp - a.timestamp),
  );

  private toEntry(item: TimelineItem, index: number): TimelineEntry {
    const kind = item.kind ?? 'note';
    const timestamp = Date.parse(item.date);
    const valid = !Number.isNaN(timestamp);
    const lang = this.lang();
    return {
      key: item.id ?? `${kind}-${item.date}-${index}`,
      item,
      kind,
      statusClass: KIND_CLASS[kind],
      day: valid ? formatDate(item.date, lang) : item.date,
      relative: valid ? relativeTime(item.date, lang) : '',
      timestamp: valid ? timestamp : 0,
    };
  }
}
