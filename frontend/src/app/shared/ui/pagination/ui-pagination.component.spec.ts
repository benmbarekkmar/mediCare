import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiPaginationComponent } from './ui-pagination.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [UiPaginationComponent],
  template: `<ui-pagination [page]="page()" [pageSize]="size()" [total]="total()" (pageChange)="lastPage = $event" />`,
})
class TestHostComponent {
  readonly page = signal(1);
  readonly size = signal(10);
  readonly total = signal(0);
  lastPage: number | null = null;
}

describe('UiPaginationComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let root: HTMLElement;

  /** The stub loader renders the key itself, so the labels identify controls. */
  const byLabel = (key: string): HTMLButtonElement | undefined =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === key);

  const numbered = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.ui-pagination__num')];

  const pages = (): string[] => numbered().map((button) => (button.textContent ?? '').trim());

  const step = (key: string): void => byLabel(key)?.click();

  const gaps = (): number => root.querySelectorAll('.ui-pagination__gap').length;

  /** Pushes a page through the input and forgets the previous emission. */
  const moveTo = (page: number): void => {
    host.page.set(page);
    host.lastPage = null;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, TestHostComponent],
    }).compileComponents();

    TestBed.inject(TranslateService).setDefaultLang('en');
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders nothing while there is a single page', () => {
    host.total.set(8);
    fixture.detectChanges();
    expect(root.querySelectorAll('button').length).toBe(0);
  });

  it('lists every page while the window fits', () => {
    host.total.set(50);
    moveTo(3);
    expect(gaps()).toBe(0);
    expect(pages()).toEqual(['1', '2', '3', '4', '5']);
    expect(numbered()[2]?.getAttribute('aria-current')).toBe('page');
  });

  it('collapses the middle of a long range with two gaps', () => {
    host.total.set(200);
    moveTo(10);
    expect(gaps()).toBe(2);
    expect(pages()).toEqual(['1', '9', '10', '11', '20']);
  });

  it('keeps the first page when the window sits at the end', () => {
    host.total.set(200);
    moveTo(20);
    expect(gaps()).toBe(1);
    expect(pages()).toEqual(['1', '16', '17', '18', '19', '20']);
  });

  it('keeps the last page when the window sits at the start', () => {
    host.total.set(200);
    moveTo(1);
    expect(gaps()).toBe(1);
    expect(pages()).toEqual(['1', '2', '3', '4', '5', '20']);
  });

  it('disables the controls at the bounds', () => {
    host.total.set(30);
    moveTo(1);
    expect(byLabel('ui.pagination.first')?.disabled).toBeTrue();
    expect(byLabel('ui.pagination.previous')?.disabled).toBeTrue();
    expect(byLabel('ui.pagination.next')?.disabled).toBeFalse();
    expect(byLabel('ui.pagination.last')?.disabled).toBeFalse();

    moveTo(3);
    expect(byLabel('ui.pagination.first')?.disabled).toBeFalse();
    expect(byLabel('ui.pagination.previous')?.disabled).toBeFalse();
    expect(byLabel('ui.pagination.next')?.disabled).toBeTrue();
    expect(byLabel('ui.pagination.last')?.disabled).toBeTrue();
  });

  it('emits pageChange with the clicked page number', () => {
    host.total.set(50);
    fixture.detectChanges();
    numbered()
      .find((button) => (button.textContent ?? '').trim() === '5')
      ?.click();
    expect(host.lastPage).toBe(5);
  });

  it('walks with next, previous, first and last', () => {
    host.total.set(50);
    moveTo(3);

    step('ui.pagination.next');
    expect(host.lastPage).toBe(4);

    moveTo(4);
    step('ui.pagination.previous');
    expect(host.lastPage).toBe(3);

    moveTo(2);
    step('ui.pagination.first');
    expect(host.lastPage).toBe(1);

    moveTo(2);
    step('ui.pagination.last');
    expect(host.lastPage).toBe(5);
  });

  it('stays silent when the requested page is the current one', () => {
    host.total.set(50);
    moveTo(1);
    step('ui.pagination.first');
    expect(host.lastPage).toBeNull();
  });

  it('labels every control and the navigation landmark', () => {
    host.total.set(50);
    fixture.detectChanges();
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('ui.pagination.label');
    expect(byLabel('ui.pagination.first')).toBeDefined();
    numbered().forEach((button) => expect(button.getAttribute('aria-label')).toBe('ui.pagination.page'));
    expect(root.textContent).toContain('ui.table.page');
  });

  it('re-computes the window when the page size changes', () => {
    host.total.set(100);
    host.size.set(50);
    fixture.detectChanges();
    expect(pages()).toEqual(['1', '2']);
  });
});
