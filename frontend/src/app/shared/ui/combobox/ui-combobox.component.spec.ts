import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, type Observable } from 'rxjs';
import type { Ref } from '../../../core/api/models';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiComboboxComponent } from './ui-combobox.component';

const PATIENTS: Ref[] = [
  { id: 'pat_1', iri: 'patient/1', label: 'Ada Lovelace', type: 'Patient' },
  { id: 'pat_2', iri: 'patient/2', label: 'Alan Turing', type: 'Patient' },
  { id: 'pat_3', iri: 'patient/3', label: 'Barbara Liskov', type: 'Patient' },
];

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [ReactiveFormsModule, UiComboboxComponent],
  template: `
    <ui-combobox
      label="entities.patient"
      hint="One row per person"
      [search]="search"
      [initial]="initial"
      [multiple]="multiple"
      [maxChips]="maxChips"
      [required]="true"
      [formControl]="control"
    />
  `,
})
class HostComponent {
  readonly terms: string[] = [];
  multiple = true;
  maxChips = 5;
  initial: Ref[] | Ref | null = PATIENTS;
  readonly control = new FormControl<string[] | string | null>([], [Validators.required]);

  /** Deterministic stub: the component never needs to know about a service. */
  readonly search = (term: string): Observable<Ref[]> => {
    this.terms.push(term);
    const needle = term.trim().toLowerCase();
    return of(needle.length === 0 ? PATIENTS : PATIENTS.filter((ref) => ref.label.toLowerCase().includes(needle)));
  };
}

describe('UiComboboxComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let inputEl: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, HostComponent],
    }).compileComponents();
  });

  const setup = (): void => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    inputEl = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  };

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const options = (): HTMLElement[] => Array.from(document.body.querySelectorAll('[role=option]'));
  const listbox = (): HTMLElement | null => document.body.querySelector('[role=listbox]');
  const chips = (): string[] =>
    Array.from(root().querySelectorAll('.chip__label')).map((node) => node.textContent?.trim() ?? '');

  const type = (value: string): void => {
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const key = (combo: string): void => {
    const [name, modifier] = combo.split('+');
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey: modifier === 'shift', bubbles: true }));
    fixture.detectChanges();
  };

  it('debounces the search by 300 ms and lets the last response win', fakeAsync(() => {
    setup();
    expect(host.terms).toEqual([]);

    type('a');
    tick(100);
    expect(host.terms).toEqual([]);
    type('ad');
    tick(300);
    fixture.detectChanges();

    expect(host.terms).toEqual(['ad']);
    expect(options().map((node) => node.textContent?.trim())).toEqual(['Ada Lovelace']);
    expect(listbox()).not.toBeNull();
    expect(inputEl.getAttribute('aria-expanded')).toBe('true');
  }));

  it('shows a loading row while the request is in flight', fakeAsync(() => {
    setup();
    type('ada');
    expect(document.body.textContent).toContain('ui.combobox.searching');

    tick(300);
    fixture.detectChanges();
    expect(document.body.textContent).not.toContain('ui.combobox.searching');
    expect(document.body.textContent).toContain('Ada Lovelace');
  }));

  it('navigates the listbox with the keyboard and writes ids to the form', fakeAsync(() => {
    setup();
    inputEl.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    key('ArrowDown');
    tick(300);
    fixture.detectChanges();

    expect(options().length).toBe(3);
    expect(inputEl.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);

    key('ArrowDown');
    expect(inputEl.getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    key('End');
    expect(inputEl.getAttribute('aria-activedescendant')).toBe(options()[2]?.id);
    key('Home');
    key('Enter');

    expect(host.control.value).toEqual(['pat_1']);
    expect(chips()).toEqual(['Ada Lovelace']);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');

    key('Escape');
    expect(listbox()).toBeNull();
    expect(inputEl.getAttribute('aria-expanded')).toBe('false');
  }));

  it('collapses the chips past maxChips and removes one', fakeAsync(() => {
    setup();
    host.maxChips = 2;
    fixture.detectChanges();
    host.control.setValue(['pat_1', 'pat_2', 'pat_3']);
    fixture.detectChanges();

    expect(chips()).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(root().textContent).toContain('ui.combobox.more');

    const remove = root().querySelector('.chip__remove') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toContain('ui.combobox.remove');
    remove.click();
    fixture.detectChanges();
    expect(host.control.value).toEqual(['pat_2', 'pat_3']);
  }));

  it('labels an id the search has never seen with the id itself', fakeAsync(() => {
    setup();
    host.control.setValue(['pat_9']);
    fixture.detectChanges();
    expect(chips()).toEqual(['pat_9']);
  }));

  it('falls back to initial while the form holds no value, then Backspace trims', fakeAsync(() => {
    setup();
    host.control.reset(null);
    fixture.detectChanges();
    expect(chips()).toEqual(['Ada Lovelace', 'Alan Turing', 'Barbara Liskov']);

    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input'));
    tick(300);
    fixture.detectChanges();
    key('Backspace');
    expect(host.control.value).toEqual(['pat_1', 'pat_2']);
  }));

  it('selects a single value and closes the list on pick', fakeAsync(() => {
    setup();
    host.multiple = false;
    fixture.detectChanges();
    host.control.setValue('pat_2');
    fixture.detectChanges();
    expect(inputEl.value).toBe('Alan Turing');
    expect(chips()).toEqual([]);

    type('bar');
    tick(300);
    fixture.detectChanges();
    key('ArrowDown');
    key('Enter');
    expect(host.control.value).toBe('pat_3');
    expect(inputEl.value).toBe('Barbara Liskov');
    expect(listbox()).toBeNull();
  }));

  it('disables the field and reports the required error once touched', fakeAsync(() => {
    setup();
    host.control.markAsTouched();
    fixture.detectChanges();
    expect(root().querySelector('.ui-error')?.textContent).toContain('errors.field.required');
    expect(inputEl.getAttribute('aria-invalid')).toBe('true');
    expect(inputEl.getAttribute('aria-describedby')).toContain(`${inputEl.id}-errors`);

    host.control.disable();
    fixture.detectChanges();
    expect(inputEl.disabled).toBeTrue();

    key('ArrowDown');
    expect(root().querySelector('[role=listbox]')).toBeNull();
    expect(host.terms).toEqual([]);
  }));
});
