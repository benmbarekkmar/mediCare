import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiSelectComponent, type SelectOption } from './ui-select.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [ReactiveFormsModule, UiSelectComponent],
  template: `
    <ui-select
      label="entities.department"
      hint="Where the bed lives"
      [options]="options()"
      [formControl]="control"
      placeholder="Choose a department"
      [required]="true"
    />
  `,
})
class HostComponent {
  readonly options = signal<SelectOption[]>([
    { value: 'cardio', label: 'entities.cardiology' },
    { value: 'neuro', label: 'entities.neurology' },
    { value: 12, label: 'entities.oncology' },
    { value: 'closed', label: 'entities.closedWard', disabled: true },
  ]);
  readonly control = new FormControl<string | number | null>(null, [Validators.required]);
}

describe('UiSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let selectEl: HTMLSelectElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    selectEl = (fixture.nativeElement as HTMLElement).querySelector('select') as HTMLSelectElement;
  });

  const optionEls = (): HTMLOptionElement[] => Array.from(selectEl.querySelectorAll('option'));
  const errorText = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector('.ui-error')?.textContent?.trim() ?? '';

  it('is a native select wearing the shared skin', () => {
    expect(selectEl.classList.contains('ui-control')).toBeTrue();
    expect(optionEls().length).toBe(5);
    expect(optionEls()[0]?.textContent?.trim()).toBe('Choose a department');
    expect(optionEls()[0]?.value).toBe('');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('label')?.getAttribute('for')).toBe(selectEl.id);
    expect(selectEl.getAttribute('aria-describedby')).toContain(`${selectEl.id}-hint`);
  });

  it('projects the control value through the accessor', () => {
    host.control.setValue('neuro');
    fixture.detectChanges();
    expect(selectEl.value).toBe('neuro');

    host.control.setValue(12);
    fixture.detectChanges();
    expect(selectEl.value).toBe('12');
  });

  it('writes the typed option value back to the control', () => {
    selectEl.value = 'cardio';
    selectEl.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(host.control.value).toBe('cardio');
    expect(host.control.dirty).toBeTrue();
  });

  it('keeps disabled options unreachable', () => {
    const closed = optionEls().find((option) => option.value === 'closed');
    expect(closed?.disabled).toBeTrue();
  });

  it('disables the select when the control is disabled', () => {
    host.control.disable();
    fixture.detectChanges();
    expect(selectEl.disabled).toBeTrue();
  });

  it('shows the required error after the field was touched', () => {
    expect(errorText()).toBe('');
    host.control.markAsTouched();
    fixture.detectChanges();
    expect(errorText()).toContain('errors.field.required');
    expect(selectEl.getAttribute('aria-invalid')).toBe('true');
  });

  it('renders one option per entry when the list changes', () => {
    host.options.set([{ value: 'icu', label: 'entities.intensiveCare' }]);
    fixture.detectChanges();
    expect(optionEls().length).toBe(2);
    expect(optionEls()[1]?.textContent?.trim()).toBe('entities.intensiveCare');
  });
});
