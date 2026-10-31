import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Chart } from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js/auto';

export type ChartType = 'line' | 'bar' | 'doughnut' | 'pie';

/** Brand derived palette, cycled whenever a chart needs more colours than it is given. */
const PALETTE = ['#2563EB', '#14B8A6', '#8B5CF6', '#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#64748B'];

const isArc = (type: ChartType): boolean => type === 'doughnut' || type === 'pie';

/** `number[]` is one series, `number[][]` one series per entry. */
const toSeries = (raw: number[] | number[][]): number[][] => {
  if (raw.length === 0) return [];
  return Array.isArray(raw[0]) ? (raw as number[][]) : [raw as number[]];
};

/** Chart.js paints on a canvas, so `var(--x)` has to become a real colour. */
const hexWithAlpha = (color: string, alpha: number): string => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const digits = hex[1].length === 3 ? hex[1].split('').map((char) => char + char).join('') : hex[1];
  const value = Number.parseInt(digits, 16);
  return `rgba(${(value >> 24) & 255}, ${(value >> 16) & 255}, ${(value >> 8) & 255}, ${alpha})`;
};

/** Everything one repaint reads, so the sync effect has a single dependency set. */
interface ChartState {
  readonly type: ChartType;
  readonly labels: string[];
  readonly sets: number[][];
  readonly names: string[] | null;
  readonly stacked: boolean;
  readonly legend: boolean | null;
  readonly colors: string[] | null;
  readonly label: string | null;
  readonly canvas: HTMLCanvasElement | undefined;
}

/**
 * The one chart component of the product. It draws with Chart.js, follows the
 * active theme by reading the design tokens from the host, repaints in place when
 * an input changes and always renders a visually hidden data table so the same
 * numbers reach a screen reader.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-chart',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="chart">
      @if (isEmpty()) {
        <figcaption class="chart__empty">{{ 'ui.chart.noData' | translate }}</figcaption>
      }
      <div class="chart__box" [style.height]="height()">
        <canvas #cv role="img" [attr.aria-label]="ariaLabel()"></canvas>
      </div>
    </figure>

    <table class="visually-hidden">
      <caption>{{ 'ui.chart.table' | translate }}</caption>
      @if (isArcChart()) {
        <thead>
          <tr>
            <th scope="col">{{ 'uipage.chart.category' | translate }}</th>
            <th scope="col">{{ 'uipage.chart.value' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of arcRows(); track $index) {
            <tr>
              <th scope="row">{{ row.name }}</th>
              <td>{{ row.value }}</td>
            </tr>
          }
        </tbody>
      } @else {
        <thead>
          <tr>
            <th scope="col">{{ 'uipage.chart.series' | translate: { index: 1 } }}</th>
            @for (label of labels(); track $index) {
              <th scope="col">{{ label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of seriesRows(); track $index) {
            <tr>
              <th scope="row">{{ row.name }}</th>
              @for (cell of row.cells; track $index) {
                <td>{{ cell }}</td>
              }
            </tr>
          }
        </tbody>
      }
    </table>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .chart {
        display: block;
        margin: 0;
        min-width: 0;
      }
      .chart__box {
        position: relative;
        min-width: 0;
        overflow: hidden;
      }
      .chart__box canvas {
        display: block;
        max-width: 100%;
      }
      .chart__empty {
        display: block;
        font-size: var(--fs-sm);
        color: var(--text-muted);
        padding-block-end: var(--sp-2);
      }
    `,
  ],
})
export class UiChartComponent implements AfterViewInit, OnDestroy {
  readonly type = input<ChartType>('line');
  readonly labels = input<string[]>([]);
  readonly data = input<number[] | number[][]>([]);
  /** Alias of `data` in its multi-series form, used when `data` is not bound. */
  readonly series = input<number[] | number[][] | null>(null);
  /** Legend entry per series, and the row header of the table alternative. */
  readonly names = input<string[] | null>(null);
  readonly height = input<string>('280px');
  readonly stacked = input<boolean>(false);
  /** `null` decides per chart type: legends show for doughnut/pie and multi series. */
  readonly legend = input<boolean | null>(null);
  readonly colors = input<string[] | null>(null);
  /** Free description of what the chart shows: the accessible name of the canvas. */
  readonly label = input<string | null>(null);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('cv');

  private chart: Chart | null = null;
  private renderedType: ChartType | null = null;
  private viewReady = false;
  private observer: MutationObserver | null = null;
  /** bumped on every language change so the labels below are rebuilt */
  private readonly langTick = signal(0);

  private readonly state = computed<ChartState>(() => {
    const raw = this.series() ?? this.data();
    return {
      type: this.type(),
      labels: this.labels(),
      sets: toSeries(raw),
      names: this.names(),
      stacked: this.stacked(),
      legend: this.legend(),
      colors: this.colors(),
      label: this.label(),
      canvas: this.canvas()?.nativeElement,
    };
  });

  protected readonly isEmpty = computed(() => this.state().sets.every((set) => set.length === 0));
  protected readonly isArcChart = computed(() => isArc(this.state().type));
  /** the accessible name is built synchronously so it is there on the first paint */
  protected readonly ariaLabel = computed(() => {
    const state = this.state();
    void this.langTick();
    if (state.label !== null) return state.label;
    void this.langTick();
    return this.translate.instant(`uipage.chart.aria.${state.type}`, { count: String(state.sets[0]?.length ?? 0) });
  });

  protected readonly arcRows = computed(() => {
    const state = this.state();
    const values = state.sets[0] ?? [];
    return state.labels.map((label, index) => ({ name: label, value: String(values[index] ?? '') }));
  });

  protected readonly seriesRows = computed(() => {
    const state = this.state();
    return state.sets.map((values, index) => ({
      name: this.seriesName(state, index),
      cells: values.map((value) => String(value)),
    }));
  });

  constructor() {
    // one effect for every input: reading the state registers the dependencies,
    // the chart then updates in place instead of being rebuilt
    effect(() => {
      const state = this.state();
      if (!this.viewReady) return;
      this.render(state);
    });

    // the legend is drawn on the canvas, so a language switch needs a repaint
    const langChange = this.translate.onLangChange.subscribe(() => {
      this.langTick.update((tick) => tick + 1);
      this.render(this.state());
    });
    this.destroyRef.onDestroy(() => langChange.unsubscribe());
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render(this.state());
    // the theme is a [data-theme] attribute on <html>: repaint when it flips
    this.observer = new MutationObserver(() => this.render(this.state()));
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.destroyChart();
  }

  // ---------------------------------------------------------------- internals

  private render(state: ChartState): void {
    if (!state.canvas || state.sets.every((set) => set.length === 0)) {
      this.destroyChart();
      return;
    }
    const config = this.configuration(state);
    if (this.chart && this.renderedType === config.type) {
      this.chart.data = config.data;
      this.chart.options = config.options ?? {};
      this.chart.update();
      return;
    }
    this.destroyChart();
    this.chart = new Chart(state.canvas, config);
    this.renderedType = state.type;
  }

  private destroyChart(): void {
    this.chart?.destroy();
    this.chart = null;
    this.renderedType = null;
  }

  private seriesName(state: ChartState, index: number): string {
    const custom = state.names?.[index];
    if (custom) return custom;
    if (state.sets.length === 1 && state.label) return state.label;
    return this.translate.instant('uipage.chart.series', { index: String(index + 1) });
  }

  private configuration(state: ChartState): ChartConfiguration {
    const type = state.type;
    const sets = state.sets;
    const ink = this.variable('--text', '#0f172a');
    const muted = this.variable('--text-muted', '#64748b');
    const grid = this.variable('--chart-grid', '#e2e8f0');
    const surface = this.variable('--surface', '#ffffff');
    const border = this.variable('--border', '#e2e8f0');
    const palette = this.palette(state.colors);

    const legend = {
      display: state.legend ?? (isArc(type) || sets.length > 1),
      labels: { color: ink, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 12 },
    };
    const tooltip = {
      backgroundColor: surface,
      titleColor: ink,
      bodyColor: muted,
      borderColor: border,
      borderWidth: 1,
      padding: 8,
      cornerRadius: 8,
    };
    const animation = this.prefersReducedMotion() ? false : { duration: 200, easing: 'easeOutQuart' as const };

    if (type === 'doughnut' || type === 'pie') {
      const arcType: 'doughnut' | 'pie' = type;
      const values = sets[0] ?? [];
      const options: NonNullable<ChartConfiguration<typeof arcType>['options']> = {
        responsive: true,
        maintainAspectRatio: false,
        animation,
        plugins: { legend, tooltip },
        cutout: arcType === 'doughnut' ? '62%' : 0,
      };
      return {
        type,
        data: {
          labels: state.labels,
          datasets: [
            {
              label: this.seriesName(state, 0),
              data: values,
              backgroundColor: values.map((_, index) => palette[index % palette.length] ?? PALETTE[0]),
              borderColor: surface,
              borderWidth: 2,
              hoverOffset: 4,
            },
          ],
        },
        options,
      };
    }

    const axis = {
      stacked: state.stacked,
      grid: { color: grid, drawTicks: false },
      border: { color: grid },
      ticks: { color: muted },
    };

    return {
      type,
      data: {
        labels: state.labels,
        datasets: sets.map((values, index) => {
          const color = palette[index % palette.length] ?? PALETTE[0];
          return type === 'line'
            ? {
                label: this.seriesName(state, index),
                data: values,
                borderColor: color,
                backgroundColor: hexWithAlpha(color, 0.16),
                pointBackgroundColor: color,
                borderWidth: 2,
                tension: 0.35,
                fill: state.stacked,
              }
            : {
                label: this.seriesName(state, index),
                data: values,
                backgroundColor: hexWithAlpha(color, 0.85),
                borderColor: color,
                borderWidth: 1,
                borderRadius: 4,
              };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend, tooltip },
        scales: { x: axis, y: { ...axis, beginAtZero: true } },
      },
    };
  }

  private palette(colors: string[] | null): string[] {
    if (colors && colors.length > 0) return colors.map((color) => this.resolve(color));
    return PALETTE;
  }

  private resolve(color: string): string {
    const match = /^var\((--[\w-]+)\)$/.exec(color.replace(/\s+/g, ''));
    return match ? this.variable(match[1], PALETTE[0]) : color;
  }

  private variable(name: string, fallback: string): string {
    const read = getComputedStyle(this.host.nativeElement).getPropertyValue(name).trim();
    return read.length > 0 ? read : fallback;
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
