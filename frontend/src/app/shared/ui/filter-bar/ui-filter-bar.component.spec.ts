import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import type { ListParams } from '../../../core/util/list-state';
import type { Ref } from '../../../core/api/models';
import { UiChipComponent } from '../chip/ui-chip.component';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiFilterBarComponent, type FilterPatch, type FilterSpec } from './ui-filter-bar.component';

const params = (overrides: Partial<ListParams> = {}): ListParams => ({
  page: 1,
  pageSize: 20,
  sort: null,
  order: 'asc',
  q: '',
  filters: {},
  ...overrides,
});

const ref = (id: string, label: string): Ref => ({ id, iri: `urn:test:${id}`, label, type: 'Department' });

const textOf = (node: Element | null): string => (node?.textContent ?? '').trim();

describe('ui-filter-bar', () => {
  interface Harness {
    fixture: ComponentFixture<UiFilterBarComponent>;
    patches: FilterPatch[];
    cleared: number;
  }

  const searchSpec: FilterSpec = { kind: 'search', label: 'Search', placeholder: 'Find a patient' };
  const statusSpec: FilterSpec = {
    kind: 'select',
    field: 'status',
    label: 'Status',
    options: [{ value: 'Confirmed', label: 'Confirmed' }],
  };

  /** creates the bar, records every patch and renders it once */
  function harness(filters: FilterSpec[], values: ListParams = params()): Harness {
    const fixture = TestBed.createComponent(UiFilterBarComponent);
    fixture.componentRef.setInput('filters', filters);
    fixture.componentRef.setInput('values', values);
    const state = { fixture, patches: [] as FilterPatch[], cleared: 0 };
    fixture.componentInstance.change.subscribe((patch) => state.patches.push(patch));
    fixture.componentInstance.clear.subscribe(() => {
      state.cleared += 1;
    });
    fixture.detectChanges();
    return state;
  }

  const fieldOf = (fixture: ComponentFixture<UiFilterBarComponent>): HTMLInputElement =>
    fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;

  const selectOf = (fixture: ComponentFixture<UiFilterBarComponent>): HTMLSelectElement =>
    fixture.nativeElement.querySelector('select') as HTMLSelectElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [...TRANSLATE_TEST_IMPORTS, UiFilterBarComponent] }).compileComponents();
  });

  it('waits 300 ms before it patches the search term', fakeAsync(() => {
    const { fixture, patches } = harness([searchSpec]);
    const field = fieldOf(fixture);

    field.value = 'card';
    field.dispatchEvent(new Event('input'));

    tick(299);
    expect(patches.length).withContext('nothing is emitted while the user still types').toBe(0);

    tick(5);
    expect(patches).toEqual([{ q: 'card' }]);
  }));

  it('publishes the search term on Enter and drops the pending debounce', fakeAsync(() => {
    const { fixture, patches } = harness([searchSpec]);
    const field = fieldOf(fixture);

    field.value = 'k';
    field.dispatchEvent(new Event('input'));
    field.value = 'ka';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(patches).toEqual([{ q: 'ka' }]);
    tick(400);
    expect(patches.length).withContext('the pending timer must not emit a second patch').toBe(1);
  }));

  it('keeps the typed text when the page comes back with the same q', fakeAsync(() => {
    const { fixture, patches } = harness([searchSpec]);
    const field = fieldOf(fixture);

    field.value = 'abc';
    field.dispatchEvent(new Event('input'));
    tick(300);
    expect(patches).toEqual([{ q: 'abc' }]);

    // the page echoes the patch back as new values, the field must not flicker
    fixture.componentRef.setInput('values', params({ q: 'abc' }));
    fixture.detectChanges();
    tick(300);
    expect(patches.length).toBe(1);
    expect(fieldOf(fixture).value).toBe('abc');
  }));

  it('patches the filter map when a select changes', () => {
    const { fixture, patches } = harness([statusSpec]);
    const select = selectOf(fixture);

    select.value = 'Confirmed';
    select.dispatchEvent(new Event('change'));

    expect(patches).toEqual([{ filters: { status: 'Confirmed' } }]);
  });

  it('drops the key when the select goes back to any', () => {
    const { fixture, patches } = harness([statusSpec], params({ filters: { status: 'Confirmed' } }));
    const select = selectOf(fixture);

    select.value = '';
    select.dispatchEvent(new Event('change'));

    expect(patches).toEqual([{ filters: {} }]);
  });

  it('renders one removable chip per active filter and clears only that field', () => {
    const { fixture, patches } = harness([searchSpec, statusSpec], params({ q: 'smith', filters: { status: 'Confirmed' } }));

    const chips = fixture.debugElement.queryAll(By.directive(UiChipComponent));
    expect(chips.length).withContext('the search term and the status each get a chip').toBe(2);

    (chips[0].componentInstance as UiChipComponent).removed.emit();
    expect(patches).toEqual([{ q: '' }]);
    fixture.componentRef.setInput('values', params({ q: '', filters: { status: 'Confirmed' } }));
    fixture.detectChanges();

    const left = fixture.debugElement.queryAll(By.directive(UiChipComponent));
    expect(left.length).toBe(1);
    (left[0].componentInstance as UiChipComponent).removed.emit();
    expect(patches[1]).toEqual({ filters: {} });
  });

  it('emits clear when the clear all button is pressed', () => {
    const state = harness([{ kind: 'toggle', field: 'chronic', label: 'Chronic only' }], params({ filters: { chronic: 'true' } }));

    (state.fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.fb__clear')?.click();

    expect(state.cleared).toBe(1);
  });

  it('loads entity options through the injected loader function', () => {
    const asked: string[] = [];
    const spec: FilterSpec = {
      kind: 'entity',
      field: 'department',
      label: 'Department',
      entity: 'departments',
      optionLoader: (key) => {
        asked.push(key);
        return of([ref('d1', 'Cardiology')]);
      },
    };

    const { fixture } = harness([spec]);
    fixture.detectChanges();

    expect(asked).toEqual(['departments']);
    const labels = [...fixture.nativeElement.querySelectorAll('option')].map((option) => textOf(option));
    expect(labels).toContain('Cardiology');
  });

  it('still renders the any option when the entity loader fails', () => {
    const spec: FilterSpec = {
      kind: 'entity',
      field: 'hospital',
      label: 'Hospital',
      entity: 'hospitals',
      optionLoader: () => throwError(() => new Error('offline')),
    };

    const { fixture } = harness([spec]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('option').length).toBe(1);
  });
});
